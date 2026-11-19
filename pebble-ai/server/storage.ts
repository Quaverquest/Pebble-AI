import fs from 'node:fs';
import path from 'node:path';
import { buildInitialModels } from '../src/core/catalog';
import { applySystemBestMatchRecommendations, evaluateModelCompatibility } from '../src/core/compatibility';
import type {
  HardwareSpecs,
  ModelEntry,
  PebbleSettings,
  PebbleStateSnapshot,
} from '../src/core/types';

export const DATA_DIR = path.resolve(process.cwd(), 'data');
export const IMAGES_DIR = path.join(DATA_DIR, 'images');
export const MODELS_DIR = path.join(DATA_DIR, 'models');
export const AGENT_WORKSPACE_DIR = path.join(DATA_DIR, 'agent_workspace');
const STATE_FILE = path.join(DATA_DIR, 'pebble-state.json');

export function ensureDirectories(): void {
  for (const dir of [DATA_DIR, IMAGES_DIR, MODELS_DIR, AGENT_WORKSPACE_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const briefPath = path.join(AGENT_WORKSPACE_DIR, 'notes', 'victus-optimization-notes.md');
  const scriptPath = path.join(AGENT_WORKSPACE_DIR, 'scripts', 'check_memory_budget.py');
  if (!fs.existsSync(briefPath)) {
    fs.mkdirSync(path.dirname(briefPath), { recursive: true });
    fs.writeFileSync(
      briefPath,
      `# HP Victus 15 Local AI Notes\n\n- GPU: AMD Radeon RX 6500M (4GB Dedicated VRAM, RDNA 2)\n- CPU: AMD Ryzen 5 7535HS (6C/12T)\n- RAM: 40GB DDR5\n- Backends: Vulkan Compute for LLM layer splitting (AWQ/GPTQ/GGUF/NF4), DirectML + sequential CPU offload + VAE tiling for Diffusion, AVX2 CPU RAM fallback.\n`,
      'utf8'
    );
  }
  if (!fs.existsSync(scriptPath)) {
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(
      scriptPath,
      `def calculate_offload_split(model_gb: float, vram_budget_gb: float = 3.4) -> dict:\n    gpu_gb = min(model_gb, vram_budget_gb)\n    ram_gb = max(0.0, model_gb - gpu_gb)\n    return {"vram_gb": round(gpu_gb, 2), "system_ram_gb": round(ram_gb, 2)}\n\nif __name__ == "__main__":\n    print(calculate_offload_split(7.9))\n`,
      'utf8'
    );
  }
}

export function createDefaultSettings(): PebbleSettings {
  return {
    setupCompleted: false,
    developerMode: false,
    theme: 'dark',
    themePreset: 'misty_evergreen',
    backgroundAnimation: 'aurora',
    customBackgroundUrl: undefined,
    aiCustomTheme: null,
    activeRouterId: 'omni',
    omniMode: 'automatic',
    allowUncensoredModels: true,
    preferredQuantization: 'auto',
    smartResourceMode: true,
    idleUnloadSeconds: 300,
    maxVramBudgetGb: 3.6,
    maxRamBudgetGb: 32,
    qwenLowVramEnabled: true,
    remoteEnabled: true,
    remotePort: Number(process.env.PORT || 3000),
    remotePin: '482910',
    remoteLocalNetworkOnly: true,
    localWorkers: {
      ollamaUrl: 'http://127.0.0.1:11434',
      qwenImageUrl: 'http://127.0.0.1:7861',
      voiceWorkerUrl: 'http://127.0.0.1:7862',
      pcControlWorkerUrl: 'http://127.0.0.1:7863',
      preferLocalWorkers: true,
    },
    voice: {
      selectedVoice: 'Kore',
      speakingSpeed: 1.0,
      language: 'en-US',
      vadEnabled: true,
      pushToTalk: false,
      continuousHandsFree: true,
    },
    modelStorageDir: MODELS_DIR,
  };
}

export function createInitialState(hardware: HardwareSpecs, settings: PebbleSettings): PebbleStateSnapshot {
  const now = Date.now();
  const models = buildInitialModels(hardware);

  return {
    settings,
    hardware,
    models,
    queue: [],
    memoryHistory: [
      {
        timestamp: now - 60_000,
        ramUsedGb: hardware.usedRamGb,
        vramUsedGb: 0,
        loadedModelCount: 0,
        activeModelName: null,
      },
    ],
    routingHistory: [],
    conversations: [
      {
        id: 'conv-welcome',
        title: 'Getting Started with Pebble AI',
        createdAt: now - 120_000,
        updatedAt: now - 120_000,
        systemInstruction:
          'You are Pebble AI, a helpful local-first AI assistant running inside the Pebble AI ecosystem. Be concise, accurate, and clear.',
        selectedModelId: 'pebble-chat-normal',
        useOmniRouting: true,
        temperature: 0.7,
        maxTokens: 2048,
        messages: [
          {
            id: 'msg-welcome-1',
            role: 'assistant',
            content:
              'Welcome to **Pebble AI**. **Pebble Omni** router is active in **Automatic** mode and managing your **Tiny / Small / Normal / Ultra** Chat & Image models across VRAM and system RAM.\n\nYou can:\n- Ask coding, architecture, or everyday questions here in **Chat**, or toggle **Voice** right inside Chat for hands-free spoken replies.\n- Request quick visuals directly in **Chat** (rendered via lightweight **Pebble AI Image Tiny**), or open **Image Lab** for full-resolution generation, one-click background removal, and paintbrush masking.\n- Dispatch PC mouse, keyboard, and workspace tasks in **Agent** (strictly restricted to standard censored models; uncensored models stay isolated).\n- Visit **Settings** to customize Themes & Animated Backgrounds, Built-in Models, Routers, Remote Access, and optional **Developer Mode**.',
            createdAt: now - 120_000,
            modelId: 'pebble-chat-normal',
            modelName: 'Pebble AI Chat Normal',
            backendUsed: 'Omni Ready',
            routingTask: 'general_chat',
          },
        ],
      },
    ],
    images: [
      {
        id: 'img-seed-1',
        prompt:
          'Architectural documentary photograph of a quiet modern industrial design studio with dark charcoal steel shelving, warm timber workbench, potted ferns, and soft north-facing window light, Leica 35mm film aesthetic.',
        negativePrompt: 'oversaturated, blurry, watermark, distorted geometry',
        modelId: 'pebble-image-normal',
        modelName: 'Pebble AI Image Normal',
        backendUsed: 'Seeded Showcase Asset',
        mode: 'generate',
        aspectRatio: '4:3',
        width: 1024,
        height: 768,
        steps: 28,
        seed: 418204,
        lowVramProfile: true,
        imageUrl: '/src/assets/images/sample_atelier_interior_1795043476347.jpg',
        favorite: true,
        createdAt: now - 3600_000,
        source: 'desktop',
      },
      {
        id: 'img-seed-2',
        prompt:
          'Cinematic architectural photograph of a cantilevered dark anodized steel and cedar research cabin perched on a misty evergreen mountain ridge at twilight, soft interior amber lamp glow.',
        negativePrompt: 'cartoon, neon glow, low resolution',
        modelId: 'pebble-image-normal',
        modelName: 'Pebble AI Image Normal',
        backendUsed: 'Seeded Showcase Asset',
        mode: 'generate',
        aspectRatio: '16:9',
        width: 1024,
        height: 576,
        steps: 32,
        seed: 902114,
        lowVramProfile: true,
        imageUrl: '/src/assets/images/sample_alpine_observatory_1795043477194.jpg',
        favorite: false,
        createdAt: now - 2400_000,
        source: 'desktop',
      },
      {
        id: 'img-seed-3',
        prompt:
          'Minimalist studio product photography of a faceted smoked glass botanical terrarium holding deep emerald moss and river pebbles resting on matte dark basalt stone, soft diffused side lighting.',
        negativePrompt: 'plastic texture, harsh flash, cluttered background',
        modelId: 'pebble-image-small',
        modelName: 'Pebble AI Image Small',
        backendUsed: 'Seeded Showcase Asset',
        mode: 'generate',
        aspectRatio: '1:1',
        width: 768,
        height: 768,
        steps: 24,
        seed: 774312,
        lowVramProfile: true,
        imageUrl: '/src/assets/images/sample_botanical_terrarium_1795043476520.jpg',
        favorite: true,
        createdAt: now - 1200_000,
        source: 'desktop',
      },
    ],
    voiceHistory: [],
    agentTasks: [],
    remoteDevices: [],
  };
}

export function loadPersistedState(hardware: HardwareSpecs): PebbleStateSnapshot {
  ensureDirectories();
  const defaults = createDefaultSettings();
  if (!fs.existsSync(STATE_FILE)) {
    const initial = createInitialState(hardware, defaults);
    savePersistedState(initial);
    return initial;
  }

  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PebbleStateSnapshot>;
    const mergedSettings: PebbleSettings = {
      ...defaults,
      ...(parsed.settings ?? {}),
      localWorkers: {
        ...defaults.localWorkers,
        ...(parsed.settings?.localWorkers ?? {}),
      },
      voice: {
        ...defaults.voice,
        ...(parsed.settings?.voice ?? {}),
      },
    };

    const initial = createInitialState(hardware, mergedSettings);
    // Merge newly added Pebble catalog models seamlessly while keeping user state/customizations
    const savedModelsById = new Map((parsed.models ?? []).map((m) => [m.id, m]));
    const mergedModelsMap = new Map<string, ModelEntry>();

    for (const seedModel of initial.models) {
      const existing = savedModelsById.get(seedModel.id);
      if (existing) {
        mergedModelsMap.set(seedModel.id, {
          ...seedModel,
          ...existing,
          isPebbleModel: seedModel.isPebbleModel,
          tier: seedModel.tier,
          censorship: seedModel.censorship,
          baseModelRepo: seedModel.baseModelRepo,
          noDownloadRequired: seedModel.noDownloadRequired ?? true,
          installed: seedModel.noDownloadRequired ? true : existing.installed,
          downloadState: seedModel.noDownloadRequired ? 'completed' : existing.downloadState,
          downloadProgress: seedModel.noDownloadRequired ? 100 : existing.downloadProgress,
        });
      } else {
        mergedModelsMap.set(seedModel.id, seedModel);
      }
    }

    for (const m of parsed.models ?? []) {
      if (!mergedModelsMap.has(m.id)) {
        mergedModelsMap.set(m.id, m);
      }
    }

    const evaluatedModels = Array.from(mergedModelsMap.values()).map((m) => ({
      ...m,
      compatibility: evaluateModelCompatibility({
        repoId: m.repoId,
        parametersBillion: m.parametersBillion,
        quantization: m.quantization,
        diskSizeGb: m.diskSizeGb,
        supportedTasks: m.supportedTasks,
        hostRamGb: hardware.totalRamGb,
        hostVramGb: hardware.isGpuAccelerated ? hardware.gpuVramGb : 0,
        hostFreeDiskGb: hardware.diskFreeGb,
        isGpuAccelerated: hardware.isGpuAccelerated,
        gpuVendor: hardware.gpuVendor,
        rocmAvailable: hardware.amdAcceleration?.rocmAvailable,
        vulkanAvailable: hardware.amdAcceleration?.vulkanAvailable,
        directmlAvailable: hardware.amdAcceleration?.directmlAvailable,
      }),
    }));

    return {
      ...initial,
      ...parsed,
      settings: mergedSettings,
      hardware,
      models: applySystemBestMatchRecommendations(evaluatedModels, hardware),
      conversations:
        parsed.conversations && parsed.conversations.length > 0
          ? parsed.conversations
          : initial.conversations,
      images: parsed.images ?? initial.images,
      queue: [],
      routingHistory: parsed.routingHistory ?? [],
      memoryHistory: parsed.memoryHistory ?? initial.memoryHistory,
      voiceHistory: parsed.voiceHistory ?? [],
      agentTasks: parsed.agentTasks ?? [],
      remoteDevices: parsed.remoteDevices ?? [],
    };
  } catch (err) {
    console.error('Failed to read pebble-state.json, recreating defaults:', err);
    const initial = createInitialState(hardware, defaults);
    savePersistedState(initial);
    return initial;
  }
}

export function savePersistedState(state: PebbleStateSnapshot): void {
  ensureDirectories();
  const tmpFile = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmpFile, STATE_FILE);
}
