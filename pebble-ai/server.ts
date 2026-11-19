import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { createServer as createViteServer } from 'vite';
import {
  buildVoiceSystemActionSummary,
  executeImageStudioTask,
  executeSandboxedAgentStep,
  generateThemeFromBackgroundImage,
  listWorkspaceFilesRecursive,
  planAgentTaskSteps,
  resolveSafeSandboxPath,
  streamChatCompletion,
  synthesizeSpeechWav,
  transcribeAudioBuffer,
} from './server/ai';
import { inspectHardware } from './server/hardware';
import { executeHostPcControl } from './server/pcControl';
import {
  AGENT_WORKSPACE_DIR,
  createDefaultSettings,
  IMAGES_DIR,
  loadPersistedState,
  savePersistedState,
} from './server/storage';
import { applySystemBestMatchRecommendations, evaluateModelCompatibility } from './src/core/compatibility';
import {
  applyLifecyclePlan,
  findIdleModelsToUnload,
  isModelActiveInMemory,
  planModelLoad,
  requantizeModelEntry,
} from './src/core/lifecycle';
import { getRouterProfile, resolveOmniRoute } from './src/core/omni';
import {
  canModelControlPc,
  getEffectiveCensorshipMode,
  parsePcControlCommand,
} from './src/core/safety';
import type {
  AgentTask,
  ChatMessage,
  Conversation,
  GeneratedImageRecord,
  ModelEntry,
  ModelTaskProfile,
  OmniMode,
  PebbleStateSnapshot,
  QueuedModelTask,
  RemoteDevice,
  RouterId,
} from './src/core/types';

const PORT = Number(process.env.PORT || 3000);

async function bootstrap() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  const initialHardware = await inspectHardware(createDefaultSettings(), 0);

  let state: PebbleStateSnapshot = loadPersistedState(initialHardware);
  const activeStreams = new Map<string, AbortController>();
  const downloadTimers = new Map<string, NodeJS.Timeout>();
  let imageQueueChain: Promise<unknown> = Promise.resolve();

  function getActiveVramGb(): number {
    return Number(
      state.models
        .filter((m) => isModelActiveInMemory(m))
        .reduce((acc, m) => acc + m.vramAllocatedGb, 0)
        .toFixed(2)
    );
  }

  function recordMemorySnapshot() {
    const active = state.models.filter((m) => isModelActiveInMemory(m));
    const vramUsedGb = getActiveVramGb();
    const ramModelsGb = active.reduce((acc, m) => acc + m.ramAllocatedGb, 0);
    state.memoryHistory.push({
      timestamp: Date.now(),
      ramUsedGb: Number((state.hardware.usedRamGb + ramModelsGb).toFixed(2)),
      vramUsedGb,
      loadedModelCount: active.length,
      activeModelName: active[0]?.name ?? null,
    });
    if (state.memoryHistory.length > 60) {
      state.memoryHistory = state.memoryHistory.slice(-60);
    }
  }

  async function refreshHardware() {
    state.hardware = await inspectHardware(state.settings, getActiveVramGb());
    return state.hardware;
  }

  function activateModelThroughLifecycle(
    targetModelId: string,
    forceCpuFallback = false
  ): { unloadedNames: string[]; target: ModelEntry } {
    const plan = planModelLoad(state.models, targetModelId, state.settings, {
      forceCpuFallback,
    });
    state.models = applyLifecyclePlan(state.models, plan, Date.now());
    recordMemorySnapshot();
    savePersistedState(state);
    return {
      unloadedNames: plan.modelsToUnload.map((m) => m.name),
      target: state.models.find((m) => m.id === targetModelId)!,
    };
  }

  function isRemoteRequestAuthorized(req: express.Request): boolean {
    const deviceToken = req.header('x-pebble-device-id');
    if (!deviceToken) return true;
    if (!state.settings.remoteEnabled) return false;
    const device = state.remoteDevices.find((d) => d.id === deviceToken && !d.revoked);
    if (device) {
      device.lastSeenAt = Date.now();
      return true;
    }
    return false;
  }

  // Idle model unloading reaper (runs every 15s)
  setInterval(() => {
    const expired = findIdleModelsToUnload(
      state.models,
      Date.now(),
      state.settings.idleUnloadSeconds
    );
    if (expired.length > 0) {
      const expiredIds = new Set(expired.map((m) => m.id));
      state.models = state.models.map((m) =>
        expiredIds.has(m.id)
          ? { ...m, status: 'unloaded', vramAllocatedGb: 0, ramAllocatedGb: 0, gpuLayersLoaded: 0 }
          : m
      );
      recordMemorySnapshot();
      savePersistedState(state);
    }
  }, 15_000);

  // --- API Routes ---

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'Pebble AI', time: new Date().toISOString() });
  });

  app.get('/api/state', async (_req, res) => {
    await refreshHardware();
    state.models = applySystemBestMatchRecommendations(state.models, state.hardware);
    res.json(state);
  });

  app.get('/api/hardware', async (_req, res) => {
    const hw = await refreshHardware();
    res.json(hw);
  });

  app.patch('/api/settings', async (req, res) => {
    const patch = req.body as Partial<PebbleStateSnapshot['settings']>;
    state.settings = {
      ...state.settings,
      ...patch,
      localWorkers: {
        ...state.settings.localWorkers,
        ...(patch.localWorkers ?? {}),
      },
      voice: {
        ...state.settings.voice,
        ...(patch.voice ?? {}),
      },
    };
    await refreshHardware();
    state.models = applySystemBestMatchRecommendations(state.models, state.hardware);
    savePersistedState(state);
    res.json({ settings: state.settings, hardware: state.hardware, models: state.models });
  });

  app.post('/api/omni/mode', (req, res) => {
    const { mode } = req.body as { mode: OmniMode };
    if (!['automatic', 'balanced', 'manual'].includes(mode)) {
      res.status(400).json({ error: 'Invalid router mode.' });
      return;
    }
    state.settings.omniMode = mode;
    savePersistedState(state);
    res.json({ omniMode: mode, settings: state.settings });
  });

  app.post('/api/routers/select', (req, res) => {
    const { routerId, mode, allowUncensoredModels, preferredQuantization } = req.body as {
      routerId?: RouterId;
      mode?: OmniMode;
      allowUncensoredModels?: boolean;
      preferredQuantization?: PebbleStateSnapshot['settings']['preferredQuantization'];
    };

    if (routerId && ['omni', 'amd_hardware', 'uncensored', 'edge_voice'].includes(routerId)) {
      state.settings.activeRouterId = routerId;
    }
    if (mode && ['automatic', 'balanced', 'manual'].includes(mode)) {
      state.settings.omniMode = mode;
    }
    if (typeof allowUncensoredModels === 'boolean') {
      state.settings.allowUncensoredModels = allowUncensoredModels;
    }
    if (preferredQuantization) {
      state.settings.preferredQuantization = preferredQuantization;
    }

    savePersistedState(state);
    res.json({ settings: state.settings });
  });

  app.post('/api/routers/dry-run', (req, res) => {
    const {
      prompt,
      routerId,
      mode,
      manualModelId,
      hasImageAttachment,
    } = req.body as {
      prompt: string;
      routerId?: RouterId;
      mode?: OmniMode;
      manualModelId?: string;
      hasImageAttachment?: boolean;
    };

    const route = resolveOmniRoute({
      prompt: prompt || 'Summarize hardware utilization',
      hasImageAttachment,
      routerId: routerId || state.settings.activeRouterId,
      mode: mode || state.settings.omniMode,
      manualModelId,
      allowUncensoredModels: state.settings.allowUncensoredModels,
      preferredQuantization: state.settings.preferredQuantization,
      models: state.models,
      preferLocalWorkers: state.settings.localWorkers.preferLocalWorkers,
      activeWorkers: state.hardware.activeWorkers,
    });

    const offloadPlan = planModelLoad(state.models, route.selectedModel.id, state.settings);
    res.json({ route, offloadPlan });
  });

  // --- Model Lifecycle, Re-quantization & Full Hugging Face Hub Browser ---

  app.post('/api/models/load', async (req, res) => {
    const { modelId, forceCpuFallback } = req.body as {
      modelId: string;
      forceCpuFallback?: boolean;
    };
    try {
      const result = activateModelThroughLifecycle(modelId, Boolean(forceCpuFallback));
      await refreshHardware();
      res.json({
        loaded: result.target,
        unloadedNames: result.unloadedNames,
        models: state.models,
        hardware: state.hardware,
        memoryHistory: state.memoryHistory,
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/models/unload', async (req, res) => {
    const { modelId } = req.body as { modelId: string };
    state.models = state.models.map((m) =>
      m.id === modelId
        ? { ...m, status: 'unloaded', vramAllocatedGb: 0, ramAllocatedGb: 0, gpuLayersLoaded: 0 }
        : m
    );
    recordMemorySnapshot();
    await refreshHardware();
    savePersistedState(state);
    res.json({ models: state.models, hardware: state.hardware, memoryHistory: state.memoryHistory });
  });

  app.post('/api/models/quantize', async (req, res) => {
    const { modelId, quantization } = req.body as { modelId: string; quantization: string };
    const hw = await refreshHardware();
    state.models = applySystemBestMatchRecommendations(
      state.models.map((m) =>
        m.id === modelId ? requantizeModelEntry(m, quantization, hw) : m
      ),
      hw
    );
    savePersistedState(state);
    res.json({ models: state.models });
  });

  app.post('/api/models/profile', (req, res) => {
    const { modelId, profile, enabled } = req.body as {
      modelId: string;
      profile: ModelTaskProfile;
      enabled: boolean;
    };
    state.models = state.models.map((m) => {
      if (m.id === modelId) {
        const next = enabled
          ? Array.from(new Set([...m.assignedProfiles, profile]))
          : m.assignedProfiles.filter((p) => p !== profile);
        return { ...m, assignedProfiles: next };
      }
      if (enabled && m.assignedProfiles.includes(profile) && profile !== 'general_chat') {
        return { ...m, assignedProfiles: m.assignedProfiles.filter((p) => p !== profile) };
      }
      return m;
    });
    savePersistedState(state);
    res.json({ models: state.models });
  });

  app.get('/api/models/discover', async (req, res) => {
    const query = String(req.query.q || '').trim();
    const pipeline = String(req.query.pipeline || '').trim();
    const quantFilter = String(req.query.quant || 'all').toLowerCase();
    const sort = String(req.query.sort || 'downloads').trim();
    const page = Math.max(0, Number(req.query.page || 0));
    const pageSize = Math.min(30, Math.max(12, Number(req.query.limit || 24)));

    const hw = await refreshHardware();
    const evalRam = hw.totalRamGb;
    const evalVram = hw.isGpuAccelerated ? hw.gpuVramGb : 0;

    try {
      const url = new URL('https://huggingface.co/api/models');
      const combinedSearch = [
        query,
        quantFilter !== 'all' ? quantFilter : '',
      ]
        .filter(Boolean)
        .join(' ')
        .trim();

      if (combinedSearch) {
        url.searchParams.set('search', combinedSearch);
      }
      if (pipeline && pipeline !== 'all') {
        url.searchParams.set('pipeline_tag', pipeline);
      }
      url.searchParams.set('sort', ['downloads', 'likes', 'lastModified'].includes(sort) ? sort : 'downloads');
      url.searchParams.set('direction', '-1');
      // Fetch a slightly wider window so page navigation is smooth across all of Hugging Face Hub
      url.searchParams.set('limit', String((page + 1) * pageSize));

      const hfRes = await fetch(url.toString());
      if (!hfRes.ok) {
        throw new Error(`Hugging Face API returned ${hfRes.status}`);
      }
      const items = (await hfRes.json()) as Array<{
        id: string;
        downloads?: number;
        likes?: number;
        pipeline_tag?: string;
        tags?: string[];
        lastModified?: string;
      }>;

      const slice = items.slice(page * pageSize, (page + 1) * pageSize);
      const discovered = slice.map((item) => {
        const lower = item.id.toLowerCase();
        const tags = item.tags ?? [];
        let paramsB = 7.0;
        const sizeMatch = lower.match(/(\d+(?:\.\d+)?)b\b/);
        if (sizeMatch) paramsB = Number(sizeMatch[1]);
        else if (lower.includes('0.5b') || lower.includes('500m')) paramsB = 0.5;
        else if (lower.includes('1.5b')) paramsB = 1.5;
        else if (lower.includes('3b')) paramsB = 3.0;
        else if (lower.includes('14b')) paramsB = 14.0;
        else if (lower.includes('32b')) paramsB = 32.0;
        else if (lower.includes('70b') || lower.includes('72b')) paramsB = 72.0;

        const quant = lower.includes('awq')
          ? 'AWQ'
          : lower.includes('gptq')
            ? 'GPTQ'
            : lower.includes('bnb') || lower.includes('nf4')
              ? 'BNB_NF4'
              : lower.includes('gguf')
                ? 'Q4_K_M'
                : lower.includes('fp16')
                  ? 'FP16'
                  : 'Q4_K_M';

        const supportedTasks: ModelTaskProfile[] = [];
        if (
          item.pipeline_tag === 'text-to-image' ||
          item.pipeline_tag === 'image-to-image' ||
          lower.includes('flux') ||
          lower.includes('sdxl') ||
          lower.includes('diffusion') ||
          tags.includes('diffusers')
        ) {
          supportedTasks.push('image_generation', 'image_editing');
        } else if (item.pipeline_tag === 'automatic-speech-recognition' || lower.includes('whisper')) {
          supportedTasks.push('speech_recognition');
        } else if (item.pipeline_tag === 'text-to-speech' || lower.includes('kokoro') || lower.includes('piper')) {
          supportedTasks.push('speech_generation');
        } else if (lower.includes('coder') || lower.includes('code')) {
          supportedTasks.push('coding', 'general_chat');
        } else if (
          item.pipeline_tag === 'image-text-to-text' ||
          lower.includes('vl') ||
          lower.includes('vision')
        ) {
          supportedTasks.push('vision', 'general_chat');
        } else {
          supportedTasks.push('general_chat', 'reasoning');
        }

        const isUncensored = /abliterated|uncensored|dolphin|nous|unfiltered|lorablated/i.test(lower);

        const compatibility = evaluateModelCompatibility({
          repoId: item.id,
          parametersBillion: paramsB,
          quantization: quant,
          supportedTasks,
          hostRamGb: evalRam,
          hostVramGb: evalVram,
          hostFreeDiskGb: hw.diskFreeGb,
          isGpuAccelerated: hw.isGpuAccelerated,
          gpuVendor: hw.gpuVendor,
          rocmAvailable: hw.amdAcceleration?.rocmAvailable,
          vulkanAvailable: hw.amdAcceleration?.vulkanAvailable,
          directmlAvailable: hw.amdAcceleration?.directmlAvailable,
        });

        return {
          repoId: item.id,
          name: item.id.split('/').pop() || item.id,
          family: item.id.split('/')[0] || 'Community',
          downloads: item.downloads ?? 0,
          likes: item.likes ?? 0,
          pipelineTag: item.pipeline_tag || 'text-generation',
          lastModified: item.lastModified,
          parametersBillion: paramsB,
          quantization: quant,
          censorship: isUncensored ? ('uncensored' as const) : ('censored' as const),
          supportedTasks,
          compatibility,
        };
      });

      res.json({
        results: discovered,
        page,
        hasMore: items.length >= (page + 1) * pageSize,
        source: 'Hugging Face Hub',
      });
    } catch (err) {
      res.status(502).json({
        error: `Could not reach Hugging Face Hub: ${(err as Error).message}`,
        results: [],
      });
    }
  });

  app.post('/api/models/add', async (req, res) => {
    const body = req.body as {
      repoId: string;
      name: string;
      family?: string;
      description?: string;
      parametersBillion: number;
      quantization: string;
      supportedTasks: ModelTaskProfile[];
      censorship?: 'censored' | 'uncensored';
      localPath?: string;
      instantReady?: boolean;
    };

    if (!body.repoId || !body.name) {
      res.status(400).json({ error: 'Model repoId and name are required.' });
      return;
    }

    const hw = await refreshHardware();
    const compatibility = evaluateModelCompatibility({
      repoId: body.repoId,
      parametersBillion: body.parametersBillion || 7,
      quantization: body.quantization || 'Q4_K_M',
      supportedTasks: body.supportedTasks?.length ? body.supportedTasks : ['general_chat'],
      hostRamGb: hw.totalRamGb,
      hostVramGb: hw.isGpuAccelerated ? hw.gpuVramGb : 0,
      hostFreeDiskGb: hw.diskFreeGb,
      isGpuAccelerated: hw.isGpuAccelerated,
      gpuVendor: hw.gpuVendor,
      rocmAvailable: hw.amdAcceleration?.rocmAvailable,
      vulkanAvailable: hw.amdAcceleration?.vulkanAvailable,
      directmlAvailable: hw.amdAcceleration?.directmlAvailable,
    });

    const id = body.repoId.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const existing = state.models.find((m) => m.id === id);
    if (existing) {
      res.json({ model: existing, models: state.models });
      return;
    }

    // No download required by default: mounts on demand / via server or local cache
    const noDownload = body.instantReady !== false;
    const isLocalImport = Boolean(body.localPath);
    const entry: ModelEntry = {
      id,
      name: body.name,
      repoId: body.repoId,
      baseModelRepo: body.repoId,
      family: body.family || 'Hugging Face',
      description:
        body.description ||
        `Mounted from ${isLocalImport ? 'local filesystem' : 'Hugging Face Hub'} (${body.repoId}) with instant ready-to-route execution.`,
      parametersBillion: body.parametersBillion || 7,
      quantization: body.quantization || 'Q4_K_M',
      diskSizeGb: compatibility.estimatedDiskGb,
      supportedTasks: body.supportedTasks?.length ? body.supportedTasks : ['general_chat'],
      assignedProfiles: [],
      censorship: body.censorship || (/uncensored|abliterated/i.test(body.repoId) ? 'uncensored' : 'censored'),
      noDownloadRequired: noDownload,
      installed: isLocalImport || noDownload,
      downloadState: isLocalImport || noDownload ? 'completed' : 'downloading',
      downloadProgress: isLocalImport || noDownload ? 100 : 5,
      localPath: body.localPath,
      priority: 'normal',
      status: 'unloaded',
      vramAllocatedGb: 0,
      ramAllocatedGb: 0,
      gpuLayersLoaded: 0,
      loadCount: 0,
      compatibility,
    };

    state.models = applySystemBestMatchRecommendations([...state.models, entry], hw);
    savePersistedState(state);
    if (!isLocalImport && !noDownload) {
      startModelDownloadTicker(entry.id);
    }
    res.json({ model: entry, models: state.models });
  });

  function startModelDownloadTicker(modelId: string) {
    if (downloadTimers.has(modelId)) {
      clearInterval(downloadTimers.get(modelId)!);
    }
    const timer = setInterval(() => {
      const m = state.models.find((item) => item.id === modelId);
      if (!m || m.downloadState !== 'downloading') {
        clearInterval(timer);
        downloadTimers.delete(modelId);
        return;
      }
      m.downloadProgress = Math.min(100, m.downloadProgress + 25);
      if (m.downloadProgress >= 100) {
        m.downloadState = 'completed';
        m.installed = true;
        const manifestPath = path.join(state.settings.modelStorageDir, `${m.id}.json`);
        fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
        fs.writeFileSync(
          manifestPath,
          JSON.stringify({ id: m.id, repoId: m.repoId, registeredAt: new Date().toISOString() }, null, 2),
          'utf8'
        );
        m.localPath = manifestPath;
        clearInterval(timer);
        downloadTimers.delete(modelId);
      }
      savePersistedState(state);
    }, 500);
    downloadTimers.set(modelId, timer);
  }

  app.post('/api/models/:id/download', (req, res) => {
    const { id } = req.params;
    const { action } = req.body as { action: 'start' | 'pause' | 'resume' | 'delete' };
    const model = state.models.find((m) => m.id === id);
    if (!model) {
      res.status(404).json({ error: 'Model not found.' });
      return;
    }

    if (action === 'delete') {
      if (downloadTimers.has(id)) {
        clearInterval(downloadTimers.get(id)!);
        downloadTimers.delete(id);
      }
      if (model.isPrimaryImageModel || model.isPebbleModel) {
        model.status = 'unloaded';
        model.vramAllocatedGb = 0;
        model.ramAllocatedGb = 0;
        model.gpuLayersLoaded = 0;
        savePersistedState(state);
        res.json({ models: state.models, message: `${model.name} unloaded from memory.` });
        return;
      }
      model.installed = false;
      model.downloadState = 'idle';
      model.downloadProgress = 0;
      model.status = 'unloaded';
      model.vramAllocatedGb = 0;
      model.ramAllocatedGb = 0;
      model.gpuLayersLoaded = 0;
    } else if (action === 'pause') {
      model.downloadState = 'paused';
      if (downloadTimers.has(id)) {
        clearInterval(downloadTimers.get(id)!);
        downloadTimers.delete(id);
      }
    } else if (action === 'start' || action === 'resume') {
      model.downloadState = 'downloading';
      if (model.downloadProgress >= 100) model.downloadProgress = 10;
      startModelDownloadTicker(id);
    }

    savePersistedState(state);
    res.json({ models: state.models });
  });

  // --- Conversations & Streaming Chat ---

  app.post('/api/conversations', (req, res) => {
    const { title, systemInstruction, selectedModelId, useOmniRouting } = req.body as {
      title?: string;
      systemInstruction?: string;
      selectedModelId?: string;
      useOmniRouting?: boolean;
    };
    const now = Date.now();
    const conv: Conversation = {
      id: `conv-${now}-${Math.random().toString(36).slice(2, 6)}`,
      title: title || 'New Conversation',
      createdAt: now,
      updatedAt: now,
      systemInstruction:
        systemInstruction ||
        'You are Pebble AI, a helpful, concise local-first assistant.',
      selectedModelId: selectedModelId || 'pebble-chat-normal',
      useOmniRouting: useOmniRouting ?? true,
      temperature: 0.7,
      maxTokens: 2048,
      messages: [],
    };
    state.conversations.unshift(conv);
    savePersistedState(state);
    res.json({ conversation: conv, conversations: state.conversations });
  });

  app.patch('/api/conversations/:id', (req, res) => {
    const { id } = req.params;
    const conv = state.conversations.find((c) => c.id === id);
    if (!conv) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    Object.assign(conv, req.body, { updatedAt: Date.now() });
    savePersistedState(state);
    res.json({ conversation: conv });
  });

  app.delete('/api/conversations/:id', (req, res) => {
    state.conversations = state.conversations.filter((c) => c.id !== req.params.id);
    savePersistedState(state);
    res.json({ conversations: state.conversations });
  });

  app.post('/api/chat/stop', (req, res) => {
    const { streamId } = req.body as { streamId: string };
    const controller = activeStreams.get(streamId);
    if (controller) {
      controller.abort();
      activeStreams.delete(streamId);
    }
    res.json({ stopped: true });
  });

  app.post('/api/chat/stream', async (req, res) => {
    if (!isRemoteRequestAuthorized(req)) {
      res.status(401).json({ error: 'Remote device not paired or revoked.' });
      return;
    }

    const {
      conversationId,
      prompt,
      attachments,
      streamId,
      regenerateLast,
      continueLast,
      source = 'desktop',
    } = req.body as {
      conversationId: string;
      prompt: string;
      attachments?: ChatMessage['attachments'];
      streamId?: string;
      regenerateLast?: boolean;
      continueLast?: boolean;
      source?: 'desktop' | 'remote';
    };

    const conv = state.conversations.find((c) => c.id === conversationId);
    if (!conv) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }

    const startedAt = Date.now();
    await refreshHardware();

    if (regenerateLast && conv.messages.length > 0 && conv.messages[conv.messages.length - 1].role === 'assistant') {
      conv.messages.pop();
    }

    const effectivePrompt = continueLast
      ? 'Continue your previous response seamlessly from where you stopped.'
      : prompt;

    if (!regenerateLast && !continueLast) {
      const userMsg: ChatMessage = {
        id: `msg-${Date.now()}-u`,
        role: 'user',
        content: prompt,
        createdAt: Date.now(),
        attachments,
      };
      conv.messages.push(userMsg);
      if (conv.title === 'New Conversation' && prompt.trim()) {
        conv.title = prompt.trim().slice(0, 48);
      }
    }

    const effectiveMode: OmniMode = conv.useOmniRouting ? state.settings.omniMode : 'manual';
    const hasImageAttachment = Boolean(attachments?.some((a) => a.mimeType.startsWith('image/')));

    const route = resolveOmniRoute({
      prompt: effectivePrompt,
      hasImageAttachment,
      routerId: state.settings.activeRouterId,
      mode: effectiveMode,
      manualModelId: conv.selectedModelId,
      allowUncensoredModels: state.settings.allowUncensoredModels,
      preferredQuantization: state.settings.preferredQuantization,
      models: state.models,
      preferLocalWorkers: state.settings.localWorkers.preferLocalWorkers,
      activeWorkers: state.hardware.activeWorkers,
    });

    const { unloadedNames } = activateModelThroughLifecycle(route.selectedModel.id);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent('routing', {
      routerId: route.routerId,
      routerName: route.routerName,
      detectedTask: route.detectedTask,
      modelId: route.selectedModel.id,
      modelName: route.selectedModel.name,
      backendUsed: route.backendUsed,
      unloadedModels: unloadedNames,
      reasoning: route.reasoning,
    });

    const controller = new AbortController();
    const sId = streamId || `stream-${Date.now()}`;
    activeStreams.set(sId, controller);
    req.on('close', () => {
      controller.abort();
      activeStreams.delete(sId);
    });

    const assistantMsg: ChatMessage = {
      id: `msg-${Date.now()}-a`,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      modelId: route.selectedModel.id,
      modelName: route.selectedModel.name,
      backendUsed: route.backendUsed,
      routingTask: route.detectedTask,
    };

    try {
      if (route.detectedTask === 'image_generation' && !continueLast) {
        // Chat uses the lighter/draft image tier (Pebble AI Image Tiny) so Image Lab retains higher-quality studio models
        const wantsUncensored =
          route.selectedModel.censorship === 'uncensored' ||
          state.settings.activeRouterId === 'uncensored';
        const chatDraftImageModel =
          state.models.find(
            (m) => m.id === (wantsUncensored ? 'pebble-image-tiny-uncensored' : 'pebble-image-tiny')
          ) ?? route.selectedModel;

        sendEvent('token', {
          text: `${route.routerName} -> **${chatDraftImageModel.name}** (Chat Draft Tier · ${route.backendUsed})...\n\n`,
        });
        const imgResult = await executeImageStudioTask({
          prompt: effectivePrompt,
          mode: 'generate',
          aspectRatio: '1:1',
          steps: 14,
          seed: Math.floor(Math.random() * 999999),
          lowVramProfile: true,
          model: chatDraftImageModel,
          backend: route.backendUsed,
          settings: state.settings,
        });

        const imgRecord: GeneratedImageRecord = {
          id: `img-${Date.now()}`,
          prompt: effectivePrompt,
          negativePrompt: '',
          modelId: chatDraftImageModel.id,
          modelName: chatDraftImageModel.name,
          backendUsed: imgResult.actualBackend,
          mode: 'generate',
          aspectRatio: '1:1',
          width: 512,
          height: 512,
          steps: 14,
          seed: Math.floor(Math.random() * 999999),
          lowVramProfile: true,
          imageUrl: imgResult.imageUrl,
          favorite: false,
          createdAt: Date.now(),
          source,
        };
        state.images.unshift(imgRecord);

        assistantMsg.modelId = chatDraftImageModel.id;
        assistantMsg.modelName = chatDraftImageModel.name;
        assistantMsg.content = `Generated quick draft with **${chatDraftImageModel.name}** (${imgResult.actualBackend}). Saved to your **Image Lab** gallery — open Image Lab for higher-resolution Normal/Ultra renders.`;
        assistantMsg.generatedImageUrl = imgRecord.imageUrl;
        assistantMsg.backendUsed = imgResult.actualBackend;
        sendEvent('image', { image: imgRecord });
      } else {
        const historyForModel = continueLast
          ? [
              ...conv.messages,
              {
                id: 'continue-cue',
                role: 'user' as const,
                content: 'Continue seamlessly from your last sentence.',
                createdAt: Date.now(),
              },
            ]
          : conv.messages;

        let accumulated = '';
        for await (const chunk of streamChatCompletion({
          messages: historyForModel,
          systemInstruction: conv.systemInstruction,
          model: route.selectedModel,
          backend: route.backendUsed,
          settings: state.settings,
          signal: controller.signal,
        })) {
          accumulated += chunk;
          sendEvent('token', { text: chunk });
        }
        assistantMsg.content = accumulated || (controller.signal.aborted ? '(Generation stopped)' : '');
        assistantMsg.stopped = controller.signal.aborted;
      }

      conv.messages.push(assistantMsg);
      conv.updatedAt = Date.now();
      state.routingHistory.unshift({
        id: `route-${Date.now()}`,
        timestamp: Date.now(),
        userPromptSnippet: effectivePrompt.slice(0, 80),
        routerId: route.routerId,
        detectedTask: route.detectedTask,
        mode: effectiveMode,
        selectedModelId: route.selectedModel.id,
        selectedModelName: route.selectedModel.name,
        backendUsed: route.backendUsed,
        unloadedModels: unloadedNames,
        reasoning: route.reasoning,
        latencyMs: Date.now() - startedAt,
        status: 'completed',
        source,
      });
      if (state.routingHistory.length > 50) {
        state.routingHistory = state.routingHistory.slice(0, 50);
      }
      savePersistedState(state);
      sendEvent('done', {
        message: assistantMsg,
        conversation: conv,
        models: state.models,
        routingHistory: state.routingHistory,
      });
      res.end();
    } catch (err) {
      const errMessage = (err as Error).message || 'Inference failed';
      assistantMsg.content = `Error: ${errMessage}`;
      assistantMsg.error = errMessage;
      conv.messages.push(assistantMsg);
      state.routingHistory.unshift({
        id: `route-${Date.now()}`,
        timestamp: Date.now(),
        userPromptSnippet: effectivePrompt.slice(0, 80),
        routerId: route.routerId,
        detectedTask: route.detectedTask,
        mode: effectiveMode,
        selectedModelId: route.selectedModel.id,
        selectedModelName: route.selectedModel.name,
        backendUsed: route.backendUsed,
        unloadedModels: unloadedNames,
        reasoning: `${route.reasoning} Failed: ${errMessage}`,
        latencyMs: Date.now() - startedAt,
        status: 'failed',
        source,
      });
      savePersistedState(state);
      sendEvent('error', { error: errMessage, message: assistantMsg });
      res.end();
    } finally {
      activeStreams.delete(sId);
    }
  });

  // --- Image Studio (Pebble AI Image suite + Qwen Image 2.1 + Editing/Masking) ---

  app.get('/api/images/file/:filename', (req, res) => {
    const clean = path.basename(req.params.filename);
    const fullPath = path.join(IMAGES_DIR, clean);
    if (!fs.existsSync(fullPath)) {
      res.status(404).send('Image not found');
      return;
    }
    res.sendFile(fullPath);
  });

  app.post('/api/images/generate', async (req, res) => {
    if (!isRemoteRequestAuthorized(req)) {
      res.status(401).json({ error: 'Remote device not paired or revoked.' });
      return;
    }

    const body = req.body as {
      prompt: string;
      negativePrompt?: string;
      modelId?: string;
      mode?: GeneratedImageRecord['mode'];
      aspectRatio?: GeneratedImageRecord['aspectRatio'];
      steps?: number;
      seed?: number;
      batchCount?: number;
      lowVramProfile?: boolean;
      sourceImageDataUrl?: string;
      maskDataUrl?: string;
      source?: 'desktop' | 'remote';
      deviceName?: string;
    };

    const targetModel =
      state.models.find((m) => m.id === (body.modelId || 'pebble-image-normal')) ??
      state.models.find((m) => m.isPrimaryImageModel)!;

    const queueItem: QueuedModelTask = {
      id: `q-${Date.now()}`,
      modelId: targetModel.id,
      modelName: targetModel.name,
      taskType: body.mode && body.mode !== 'generate' ? 'image_editing' : 'image_generation',
      source: body.source === 'remote' ? 'remote' : 'local',
      deviceName: body.deviceName || (body.source === 'remote' ? 'Remote Wi-Fi Device' : 'Host Machine'),
      enqueuedAt: Date.now(),
      status: 'waiting',
    };
    state.queue.push(queueItem);

    const runTask = async () => {
      queueItem.status = 'running';
      const startedAt = Date.now();
      await refreshHardware();
      const { unloadedNames } = activateModelThroughLifecycle(targetModel.id);

      const backend =
        state.settings.localWorkers.preferLocalWorkers && state.hardware.activeWorkers.qwenImage
          ? 'Local Worker HTTP'
          : state.hardware.activeWorkers.cloudGateway
            ? 'Cloud Gateway (@google/genai)'
            : targetModel.compatibility.recommendedBackend;

      const aspectRatio = body.aspectRatio || '1:1';
      const dims = aspectToDims(aspectRatio);
      const count = Math.min(2, Math.max(1, Number(body.batchCount || 1)));
      const created: GeneratedImageRecord[] = [];

      try {
        for (let i = 0; i < count; i++) {
          const seed = (body.seed ?? Math.floor(Math.random() * 999999)) + i;
          const result = await executeImageStudioTask({
            prompt: body.prompt,
            negativePrompt: body.negativePrompt,
            mode: body.mode || 'generate',
            aspectRatio,
            steps: Number(body.steps || 24),
            seed,
            lowVramProfile: body.lowVramProfile ?? state.settings.qwenLowVramEnabled,
            sourceImageDataUrl: body.sourceImageDataUrl,
            maskDataUrl: body.maskDataUrl,
            model: targetModel,
            backend,
            settings: state.settings,
          });

          const record: GeneratedImageRecord = {
            id: `img-${Date.now()}-${i}`,
            prompt: body.prompt || (body.mode === 'remove_background' ? 'Background Removed' : 'Object Removed'),
            negativePrompt: body.negativePrompt || '',
            modelId: targetModel.id,
            modelName: targetModel.name,
            backendUsed: result.actualBackend,
            mode: body.mode || 'generate',
            aspectRatio,
            width: dims.width,
            height: dims.height,
            steps: Number(body.steps || 24),
            seed,
            lowVramProfile: body.lowVramProfile ?? state.settings.qwenLowVramEnabled,
            imageUrl: result.imageUrl,
            sourceImageUrl:
              body.sourceImageDataUrl?.startsWith('/src/') || body.sourceImageDataUrl?.startsWith('/api/')
                ? body.sourceImageDataUrl
                : undefined,
            editInstruction: body.mode && body.mode !== 'generate' ? body.prompt : undefined,
            favorite: false,
            createdAt: Date.now(),
            source: body.source || 'desktop',
          };

          state.images.unshift(record);
          created.push(record);
        }

        queueItem.status = 'completed';
        state.routingHistory.unshift({
          id: `route-${Date.now()}`,
          timestamp: Date.now(),
          userPromptSnippet: (body.prompt || body.mode || 'image edit').slice(0, 80),
          routerId: state.settings.activeRouterId,
          detectedTask: body.mode && body.mode !== 'generate' ? 'image_editing' : 'image_generation',
          mode: state.settings.omniMode,
          selectedModelId: targetModel.id,
          selectedModelName: targetModel.name,
          backendUsed: backend,
          unloadedModels: unloadedNames,
          reasoning: `Image Studio executed ${body.mode || 'generate'} on ${targetModel.name} (${dims.width}x${dims.height}).`,
          latencyMs: Date.now() - startedAt,
          status: 'completed',
          source: body.source || 'desktop',
        });

        state.queue = state.queue.filter((q) => q.id !== queueItem.id);
        savePersistedState(state);
        res.json({
          images: created,
          gallery: state.images,
          models: state.models,
          routingHistory: state.routingHistory,
        });
      } catch (err) {
        queueItem.status = 'failed';
        state.queue = state.queue.filter((q) => q.id !== queueItem.id);
        savePersistedState(state);
        res.status(500).json({ error: (err as Error).message });
      }
    };

    imageQueueChain = imageQueueChain.then(runTask, runTask);
  });

  // Save a client-processed PNG data URL (e.g., instant canvas background cutout) into Image Studio Gallery
  app.post('/api/images/save-cutout', (req, res) => {
    const { dataUrl, prompt, mode } = req.body as {
      dataUrl: string;
      prompt?: string;
      mode?: GeneratedImageRecord['mode'];
    };
    const match = dataUrl?.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
    if (!match) {
      res.status(400).json({ error: 'Invalid image data URL.' });
      return;
    }
    const ext = match[1] === 'png' ? 'png' : 'jpg';
    const filename = `pebble_cutout_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
    fs.writeFileSync(path.join(IMAGES_DIR, filename), Buffer.from(match[2], 'base64'));
    const record: GeneratedImageRecord = {
      id: `img-${Date.now()}`,
      prompt: prompt || 'Foreground Background Cutout (RGBA Alpha)',
      negativePrompt: '',
      modelId: 'pebble-image-small',
      modelName: 'Local Canvas Alpha Cutout',
      backendUsed: 'Browser RGBA Matting Engine',
      mode: mode || 'remove_background',
      aspectRatio: '1:1',
      width: 768,
      height: 768,
      steps: 1,
      seed: 0,
      lowVramProfile: true,
      imageUrl: `/api/images/file/${filename}`,
      favorite: false,
      createdAt: Date.now(),
      source: 'desktop',
    };
    state.images.unshift(record);
    savePersistedState(state);
    res.json({ image: record, gallery: state.images });
  });

  app.patch('/api/images/:id/favorite', (req, res) => {
    const img = state.images.find((i) => i.id === req.params.id);
    if (!img) {
      res.status(404).json({ error: 'Image not found.' });
      return;
    }
    img.favorite = !img.favorite;
    savePersistedState(state);
    res.json({ image: img, images: state.images });
  });

  app.delete('/api/images/:id', (req, res) => {
    const img = state.images.find((i) => i.id === req.params.id);
    if (img && img.imageUrl.startsWith('/api/images/file/')) {
      const filename = path.basename(img.imageUrl);
      const diskPath = path.join(IMAGES_DIR, filename);
      if (fs.existsSync(diskPath)) {
        fs.unlinkSync(diskPath);
      }
    }
    state.images = state.images.filter((i) => i.id !== req.params.id);
    savePersistedState(state);
    res.json({ images: state.images });
  });

  // --- True Voice Assistant (ASR + Hands-Free Action/Image Visuals + TTS) ---

  app.post('/api/voice/transcribe', async (req, res) => {
    const { audioBase64, mimeType, language } = req.body as {
      audioBase64: string;
      mimeType: string;
      language?: string;
    };
    try {
      activateModelThroughLifecycle('whisper-small-en', true);
      const result = await transcribeAudioBuffer({
        audioBase64,
        mimeType,
        language: language || state.settings.voice.language,
        settings: state.settings,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/voice/tts', async (req, res) => {
    const { text, voiceName } = req.body as {
      text: string;
      voiceName?: PebbleStateSnapshot['settings']['voice']['selectedVoice'];
    };
    try {
      activateModelThroughLifecycle('kokoro-82m-tts', true);
      const result = await synthesizeSpeechWav({
        text,
        voiceName: voiceName || state.settings.voice.selectedVoice,
        settings: state.settings,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/voice/converse', async (req, res) => {
    if (!isRemoteRequestAuthorized(req)) {
      res.status(401).json({ error: 'Remote device not paired or revoked.' });
      return;
    }

    const { text, language, voiceName, modelId, source = 'desktop' } = req.body as {
      text: string;
      language?: string;
      voiceName?: PebbleStateSnapshot['settings']['voice']['selectedVoice'];
      modelId?: string;
      source?: 'desktop' | 'remote';
    };

    try {
      const startedAt = Date.now();
      await refreshHardware();
      const activeRouter = getRouterProfile(state.settings.activeRouterId);
      const route = resolveOmniRoute({
        prompt: text,
        routerId: state.settings.activeRouterId,
        mode: modelId ? 'manual' : state.settings.omniMode,
        manualModelId: modelId,
        allowUncensoredModels: state.settings.allowUncensoredModels,
        preferredQuantization: state.settings.preferredQuantization,
        models: state.models,
        preferLocalWorkers: state.settings.localWorkers.preferLocalWorkers,
        activeWorkers: state.hardware.activeWorkers,
      });

      const activeModel =
        (modelId ? state.models.find((m) => m.id === modelId) : undefined) ?? route.selectedModel;
      const effectiveCensorship = getEffectiveCensorshipMode(activeModel, activeRouter.id);

      const { unloadedNames } = activateModelThroughLifecycle(activeModel.id);

      let replyText = '';
      let generatedImageUrl: string | undefined;
      let generatedImagePrompt: string | undefined;
      let actionLabel: string | undefined;
      let pcActionResult: string | undefined;

      // 1. Check Host PC mouse/keyboard intent first (STRICTLY gated to Censored models only)
      const pcCommand = parsePcControlCommand(text);
      const sysCheck = buildVoiceSystemActionSummary(
        text,
        state.hardware,
        state.models,
        activeRouter.name
      );
      const wantsLastGallery = /\b(show|display|open)\b.*\b(last|latest|recent|gallery)\b.*\b(image|picture|render|photo)\b/i.test(
        text
      );

      if (pcCommand) {
        const pcPolicy = canModelControlPc(activeModel, activeRouter.id);
        if (!pcPolicy.allowed) {
          actionLabel = 'PC Control Blocked (Uncensored Isolation)';
          pcActionResult = pcPolicy.reason;
          replyText = pcPolicy.reason;
        } else {
          const execRes = await executeHostPcControl({
            command: pcCommand,
            model: activeModel,
            routerId: activeRouter.id,
            settings: state.settings,
          });
          actionLabel = execRes.executedOnHost ? 'PC Mouse & Keyboard Executed' : 'PC Control Dispatched';
          pcActionResult = execRes.message;
          replyText = `Done. ${execRes.message}`;
        }
      } else if (sysCheck.handledLocally && sysCheck.replyText) {
        if (effectiveCensorship === 'uncensored') {
          actionLabel = 'PC Telemetry Blocked (Uncensored Isolation)';
          replyText = `${activeModel.name} is uncensored and has no access to host PC hardware or files. Switch to a censored model for PC control or diagnostics.`;
        } else {
          replyText = sysCheck.replyText;
          actionLabel = sysCheck.actionLabel;
        }
      } else if (wantsLastGallery && state.images.length > 0) {
        const latest = state.images[0];
        generatedImageUrl = latest.imageUrl;
        generatedImagePrompt = latest.prompt;
        actionLabel = 'Image Lab Gallery Displayed';
        replyText = `Here is your latest visual from Image Lab generated with ${latest.modelName}.`;
      } else if (route.detectedTask === 'image_generation') {
        try {
          const imgRes = await executeImageStudioTask({
            prompt: text,
            mode: 'generate',
            aspectRatio: '1:1',
            steps: 18,
            seed: Math.floor(Math.random() * 999999),
            lowVramProfile: state.settings.qwenLowVramEnabled,
            model: activeModel,
            backend: route.backendUsed,
            settings: state.settings,
          });
          const imgRecord: GeneratedImageRecord = {
            id: `img-${Date.now()}`,
            prompt: text,
            negativePrompt: '',
            modelId: activeModel.id,
            modelName: activeModel.name,
            backendUsed: imgRes.actualBackend,
            mode: 'generate',
            aspectRatio: '1:1',
            width: 512,
            height: 512,
            steps: 18,
            seed: Math.floor(Math.random() * 999999),
            lowVramProfile: state.settings.qwenLowVramEnabled,
            imageUrl: imgRes.imageUrl,
            favorite: false,
            createdAt: Date.now(),
            source,
          };
          state.images.unshift(imgRecord);
          generatedImageUrl = imgRecord.imageUrl;
          generatedImagePrompt = text;
          actionLabel = `Generated via ${activeModel.name}`;
          replyText = `I generated that visual using ${activeModel.name} and displayed it on screen now.`;
        } catch (imgErr) {
          actionLabel = 'Image Pipeline Unavailable';
          replyText = `I routed your visual request to ${activeModel.name}, but image synthesis failed: ${(imgErr as Error).message}`;
        }
      } else {
        for await (const chunk of streamChatCompletion({
          messages: [
            ...state.voiceHistory.slice(-6).map((v) => ({
              id: v.id,
              role: v.role,
              content: v.text,
              createdAt: v.timestamp,
            })),
            {
              id: 'current-voice',
              role: 'user',
              content: text,
              createdAt: Date.now(),
            },
          ],
          systemInstruction:
            effectiveCensorship === 'uncensored'
              ? 'You are Pebble Voice running in isolated uncensored mode. Answer directly in concise spoken sentences. You do not have access to the host PC mouse, keyboard, or filesystem.'
              : 'You are Pebble Voice, a calm, immediate, hands-free local AI voice companion with PC mouse and keyboard automation support. Reply concisely in natural spoken sentences without markdown tables or code blocks.',
          model: activeModel,
          backend: route.backendUsed,
          settings: state.settings,
        })) {
          replyText += chunk;
        }
        actionLabel = `${route.routerName} · ${activeModel.name}`;
      }

      activateModelThroughLifecycle('kokoro-82m-tts', true);
      let ttsAudioDataUrl = '';
      let ttsBackend = 'Browser Speech / Text';
      try {
        const tts = await synthesizeSpeechWav({
          text: replyText,
          voiceName: voiceName || state.settings.voice.selectedVoice,
          settings: state.settings,
        });
        ttsAudioDataUrl = tts.audioDataUrl;
        ttsBackend = tts.backendUsed;
      } catch {
        // Return text + generated image gracefully if TTS hits transient error
      }

      state.voiceHistory.push(
        {
          id: `v-${Date.now()}-u`,
          role: 'user',
          text,
          language: language || state.settings.voice.language,
          timestamp: Date.now(),
        },
        {
          id: `v-${Date.now()}-a`,
          role: 'assistant',
          text: replyText,
          language: language || state.settings.voice.language,
          timestamp: Date.now(),
          modelName: activeModel.name,
          modelCensorship: effectiveCensorship,
          generatedImageUrl,
          generatedImagePrompt,
          actionLabel,
          pcActionResult,
        }
      );

      state.routingHistory.unshift({
        id: `route-${Date.now()}`,
        timestamp: Date.now(),
        userPromptSnippet: text.slice(0, 80),
        routerId: route.routerId,
        detectedTask: route.detectedTask,
        mode: state.settings.omniMode,
        selectedModelId: activeModel.id,
        selectedModelName: activeModel.name,
        backendUsed: route.backendUsed,
        unloadedModels: unloadedNames,
        reasoning: `Voice mode via ${route.routerName} -> ${activeModel.name} (${ttsBackend}).`,
        latencyMs: Date.now() - startedAt,
        status: 'completed',
        source,
      });

      savePersistedState(state);
      res.json({
        replyText,
        audioDataUrl: ttsAudioDataUrl,
        ttsBackend,
        modelName: activeModel.name,
        modelCensorship: effectiveCensorship,
        generatedImageUrl,
        generatedImagePrompt,
        actionLabel,
        pcActionResult,
        voiceHistory: state.voiceHistory,
        gallery: state.images,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // --- Autonomous AI Agent (Sandboxed Workspace + Approval Checkpoints) ---

  app.get('/api/agent/workspace', (_req, res) => {
    const files = listWorkspaceFilesRecursive(AGENT_WORKSPACE_DIR);
    res.json({
      workingDirectory: AGENT_WORKSPACE_DIR,
      files,
    });
  });

  app.get('/api/agent/file', (req, res) => {
    try {
      const rel = String(req.query.path || '');
      const full = resolveSafeSandboxPath(rel);
      if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        res.status(404).json({ error: 'File not found.' });
        return;
      }
      res.json({ path: rel, content: fs.readFileSync(full, 'utf8') });
    } catch (err) {
      res.status(403).json({ error: (err as Error).message });
    }
  });

  app.post('/api/agent/plan', async (req, res) => {
    const { goal, modelId } = req.body as { goal: string; modelId?: string };
    if (!goal?.trim()) {
      res.status(400).json({ error: 'Agent goal is required.' });
      return;
    }

    await refreshHardware();
    const route = resolveOmniRoute({
      prompt: goal,
      routerId: state.settings.activeRouterId,
      mode: modelId ? 'manual' : state.settings.omniMode,
      manualModelId: modelId,
      allowUncensoredModels: state.settings.allowUncensoredModels,
      preferredQuantization: state.settings.preferredQuantization,
      models: state.models,
      preferLocalWorkers: state.settings.localWorkers.preferLocalWorkers,
      activeWorkers: state.hardware.activeWorkers,
    });
    const selectedModel =
      (modelId ? state.models.find((m) => m.id === modelId) : undefined) ?? route.selectedModel;
    const censorship = getEffectiveCensorshipMode(selectedModel, state.settings.activeRouterId);
    activateModelThroughLifecycle(selectedModel.id);

    const steps = await planAgentTaskSteps(goal, selectedModel, state.settings.activeRouterId);
    const hasPendingApproval = steps.some((s) => s.requiresApproval);

    const task: AgentTask = {
      id: `agent-${Date.now()}`,
      goal,
      status: hasPendingApproval ? 'awaiting_approval' : 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      workingDirectory: AGENT_WORKSPACE_DIR,
      selectedModelId: selectedModel.id,
      selectedModelName: selectedModel.name,
      modelCensorship: censorship,
      steps,
      logs: [
        {
          timestamp: Date.now(),
          level: censorship === 'uncensored' ? 'warn' : 'info',
          message: `${route.routerName} planned ${steps.length} steps using ${selectedModel.name} (${censorship === 'uncensored' ? 'Uncensored Sandbox — PC Mouse/Keyboard/Files Disabled' : 'Censored — PC & Workspace Authorized'}).`,
        },
      ],
    };

    state.agentTasks.unshift(task);
    savePersistedState(state);
    res.json({ task, tasks: state.agentTasks });
  });

  app.post('/api/agent/:taskId/approve', async (req, res) => {
    const { taskId } = req.params;
    const { approvedStepIds } = req.body as { approvedStepIds?: string[] };
    const task = state.agentTasks.find((t) => t.id === taskId);
    if (!task) {
      res.status(404).json({ error: 'Agent task not found.' });
      return;
    }

    if (task.status === 'cancelled') {
      res.status(400).json({ error: 'Task was cancelled.' });
      return;
    }

    task.status = 'running';
    const taskModel = task.selectedModelId
      ? state.models.find((m) => m.id === task.selectedModelId)
      : undefined;
    const primaryImageModel =
      state.models.find((m) => m.id === 'pebble-image-normal') ??
      state.models.find((m) => m.isPrimaryImageModel)!;

    const isCancelled = () => (task.status as AgentTask['status']) === 'cancelled';

    for (const step of task.steps) {
      if (isCancelled()) break;
      if (step.status === 'completed') continue;

      if (step.requiresApproval && step.approvalStatus === 'pending') {
        if (approvedStepIds && !approvedStepIds.includes(step.id)) {
          step.approvalStatus = 'rejected';
          step.status = 'skipped';
          task.logs.push({
            timestamp: Date.now(),
            level: 'warn',
            message: `Skipped step ${step.index} (${step.title}) — not approved.`,
          });
          continue;
        }
        step.approvalStatus = 'approved';
      }

      step.status = 'running';
      task.logs.push({
        timestamp: Date.now(),
        level: 'info',
        message: `Executing step ${step.index}: ${step.title} [${step.tool}]`,
      });

      try {
        const priorOutputs = task.steps
          .filter((s) => s.status === 'completed' && s.output)
          .map((s) => `[${s.title}]\n${s.output}`);
        const output = await executeSandboxedAgentStep(
          step,
          state.settings,
          primaryImageModel,
          priorOutputs,
          taskModel,
          state.settings.activeRouterId
        );
        step.status = 'completed';
        step.output = output;
        task.logs.push({
          timestamp: Date.now(),
          level: 'info',
          message: `Step ${step.index} completed.`,
        });
      } catch (err) {
        step.status = 'failed';
        step.output = (err as Error).message;
        task.status = 'failed';
        task.logs.push({
          timestamp: Date.now(),
          level: 'error',
          message: `Step ${step.index} failed: ${(err as Error).message}`,
        });
        break;
      }
    }

    if ((task.status as AgentTask['status']) === 'running') {
      task.status = 'completed';
      task.summary = `Completed ${task.steps.filter((s) => s.status === 'completed').length} of ${task.steps.length} steps (${task.modelCensorship === 'uncensored' ? 'Uncensored Sandboxed Mode' : 'PC + Workspace Mode'}).`;
    }
    task.updatedAt = Date.now();
    savePersistedState(state);
    res.json({
      task,
      tasks: state.agentTasks,
      workspaceFiles: listWorkspaceFilesRecursive(AGENT_WORKSPACE_DIR),
    });
  });

  // Direct PC Mouse/Keyboard Control Endpoint (strictly blocked with HTTP 403 for uncensored models)
  app.post('/api/pc-control/execute', async (req, res) => {
    const { action, x, y, button, doubleClick, deltaY, text, keys, modelId } = req.body as {
      action: 'mouse_move' | 'mouse_click' | 'mouse_scroll' | 'keyboard_type' | 'keyboard_hotkey';
      x?: number;
      y?: number;
      button?: 'left' | 'right' | 'middle';
      doubleClick?: boolean;
      deltaY?: number;
      text?: string;
      keys?: string[];
      modelId?: string;
    };

    const targetModel = modelId ? state.models.find((m) => m.id === modelId) : undefined;
    const policy = canModelControlPc(targetModel, state.settings.activeRouterId);
    if (!policy.allowed) {
      res.status(403).json({ error: policy.reason, allowed: false });
      return;
    }

    try {
      const result = await executeHostPcControl({
        command: {
          action,
          x,
          y,
          button,
          doubleClick,
          deltaY,
          text,
          keys,
          summary: `${action.replace(/_/g, ' ')} command`,
        },
        model: targetModel,
        routerId: state.settings.activeRouterId,
        settings: state.settings,
      });
      res.json(result);
    } catch (err) {
      res.status(403).json({ error: (err as Error).message, allowed: false });
    }
  });

  // Custom Background AI UI Theme Adaptation (gemini-4-hydrogen)
  app.post('/api/theme/adapt-background', async (req, res) => {
    const { dataUrl, preferLight, applyImmediately } = req.body as {
      dataUrl: string;
      preferLight?: boolean;
      applyImmediately?: boolean;
    };
    if (!dataUrl?.startsWith('data:image/')) {
      res.status(400).json({ error: 'Uploaded background image data URL is required.' });
      return;
    }

    const adapted = await generateThemeFromBackgroundImage(dataUrl, preferLight);
    if (applyImmediately) {
      state.settings.customBackgroundUrl = dataUrl;
      state.settings.aiCustomTheme = adapted.tokens;
      state.settings.theme = adapted.tokens.isDark ? 'dark' : 'light';
      state.settings.backgroundAnimation = adapted.tokens.recommendedAnimation;
      savePersistedState(state);
    }
    res.json({
      ...adapted,
      settings: state.settings,
    });
  });

  app.post('/api/agent/:taskId/cancel', (req, res) => {
    const task = state.agentTasks.find((t) => t.id === req.params.taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found.' });
      return;
    }
    task.status = 'cancelled';
    task.updatedAt = Date.now();
    task.logs.push({ timestamp: Date.now(), level: 'warn', message: 'Task cancelled by user.' });
    savePersistedState(state);
    res.json({ task, tasks: state.agentTasks });
  });

  // --- Pebble Remote (Household Wi-Fi Access & QR Pairing) ---

  app.get('/api/remote/qr', async (req, res) => {
    await refreshHardware();
    const endpoints = state.hardware.networkInterfaces;
    const primaryUrl =
      endpoints[0]?.remoteClientUrl ||
      `${req.protocol}://${req.get('host')}/remote`;

    const qrDataUrl = await QRCode.toDataURL(primaryUrl, {
      margin: 1,
      width: 220,
      color: {
        dark: '#111315',
        light: '#ffffff',
      },
    });

    res.json({
      primaryUrl,
      endpoints,
      qrDataUrl,
      pin: state.settings.remotePin,
      remoteEnabled: state.settings.remoteEnabled,
    });
  });

  app.post('/api/remote/pair', (req, res) => {
    const { pin, deviceName } = req.body as { pin: string; deviceName?: string };
    if (!state.settings.remoteEnabled) {
      res.status(403).json({ error: 'Household Wi-Fi Remote Access is currently disabled on the host PC.' });
      return;
    }
    if (String(pin).trim() !== String(state.settings.remotePin).trim()) {
      res.status(401).json({ error: 'Invalid pairing PIN. Check the Remote tab on your host PC.' });
      return;
    }

    const device: RemoteDevice = {
      id: `dev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: (deviceName || 'Household Device').slice(0, 48),
      userAgent: req.header('user-agent') || 'Unknown Browser',
      ipAddress: req.ip || req.socket.remoteAddress || 'LAN Client',
      pairedAt: Date.now(),
      lastSeenAt: Date.now(),
      revoked: false,
      allowFileUploads: true,
      allowVoice: true,
      allowImageGen: true,
    };

    state.remoteDevices.unshift(device);
    savePersistedState(state);
    res.json({ device, devices: state.remoteDevices });
  });

  app.post('/api/remote/revoke/:deviceId', (req, res) => {
    const dev = state.remoteDevices.find((d) => d.id === req.params.deviceId);
    if (dev) {
      dev.revoked = true;
      savePersistedState(state);
    }
    res.json({ devices: state.remoteDevices });
  });

  // --- Windows Installer & Local Worker Bundle Downloads ---

  const windowsFiles: Record<string, string> = {
    'electron-main.cjs': path.resolve(process.cwd(), 'windows/electron-main.cjs'),
    'electron-builder.yml': path.resolve(process.cwd(), 'windows/electron-builder.yml'),
    'installer.nsh': path.resolve(process.cwd(), 'windows/installer.nsh'),
    'pebble_llm_worker.py': path.resolve(process.cwd(), 'windows/workers/pebble_llm_worker.py'),
    'qwen_image_worker.py': path.resolve(process.cwd(), 'windows/workers/qwen_image_worker.py'),
    'voice_worker.py': path.resolve(process.cwd(), 'windows/workers/voice_worker.py'),
    'pc_control_worker.py': path.resolve(process.cwd(), 'windows/workers/pc_control_worker.py'),
    'setup-victus-rx6500m.ps1': path.resolve(process.cwd(), 'windows/setup-victus-rx6500m.ps1'),
    'INSTALL_AND_RECOVERY.md': path.resolve(process.cwd(), 'docs/INSTALL_AND_RECOVERY.md'),
  };

  app.get('/api/windows/files', (_req, res) => {
    const list = Object.entries(windowsFiles).map(([key, filePath]) => ({
      key,
      exists: fs.existsSync(filePath),
      sizeBytes: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0,
    }));
    res.json({ files: list });
  });

  app.get('/api/windows/download/:fileKey', (req, res) => {
    const target = windowsFiles[req.params.fileKey];
    if (!target || !fs.existsSync(target)) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }
    res.download(target, req.params.fileKey);
  });

  app.get('/api/diagnostics/export', async (_req, res) => {
    await refreshHardware();
    const report = {
      exportedAt: new Date().toISOString(),
      app: 'Pebble AI',
      hardware: state.hardware,
      settings: {
        ...state.settings,
        remotePin: '******',
      },
      modelsSummary: state.models.map((m) => ({
        id: m.id,
        name: m.name,
        quantization: m.quantization,
        status: m.status,
        tier: m.compatibility.tier,
        backend: m.compatibility.recommendedBackend,
        gpuLayers: `${m.compatibility.gpuLayersOffloaded}/${m.compatibility.totalLayers}`,
        vramAllocatedGb: m.vramAllocatedGb,
        ramAllocatedGb: m.ramAllocatedGb,
      })),
      recentRouting: state.routingHistory.slice(0, 15),
    };
    res.setHeader('Content-Disposition', 'attachment; filename="pebble-diagnostics.json"');
    res.json(report);
  });

  // --- Vite Dev Middleware or Static Production Build ---

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Pebble AI Server running on http://0.0.0.0:${PORT}`);
  });
}

function aspectToDims(aspectRatio: GeneratedImageRecord['aspectRatio']): { width: number; height: number } {
  switch (aspectRatio) {
    case '16:9':
      return { width: 896, height: 512 };
    case '9:16':
      return { width: 512, height: 896 };
    case '4:3':
      return { width: 768, height: 576 };
    case '3:4':
      return { width: 576, height: 768 };
    default:
      return { width: 768, height: 768 };
  }
}

bootstrap().catch((err) => {
  console.error('Fatal Pebble AI startup error:', err);
  process.exit(1);
});
