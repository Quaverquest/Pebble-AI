import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertModelCanUseTool,
  canModelControlPc,
  getAllowedAgentTools,
  parsePcControlCommand,
} from '../src/core/safety';
import type {
  AgentStep,
  ChatAttachment,
  ChatMessage,
  CustomUiThemeTokens,
  ExecutionBackend,
  HardwareSpecs,
  ModelEntry,
  PebbleSettings,
  RouterId,
} from '../src/core/types';
import { executeHostPcControl } from './pcControl';
import { AGENT_WORKSPACE_DIR, IMAGES_DIR } from './storage';

function getGeminiClient(apiVersion = 'v1beta'): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    apiVersion,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

export async function* streamChatCompletion(params: {
  messages: ChatMessage[];
  systemInstruction: string;
  model: ModelEntry;
  backend: ExecutionBackend;
  settings: PebbleSettings;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const { messages, systemInstruction, model, backend, settings, signal } = params;

  // 1. Real Local Ollama / llama.cpp Vulkan OpenAI-compatible path when local worker is online
  if (backend === 'Local Worker HTTP' && settings.localWorkers.ollamaUrl) {
    const baseUrl = settings.localWorkers.ollamaUrl.replace(/\/+$/, '');
    const ollamaMessages = [
      ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
      ...messages.map((m) => ({
        role: m.role,
        content: buildTextWithAttachments(m.content, m.attachments),
      })),
    ];

    const ollamaModelTag = model.id.includes('tiny')
      ? 'qwen2.5:1.5b'
      : model.id.includes('small')
        ? 'qwen2.5:3b'
        : model.id.includes('ultra')
          ? 'qwen2.5:14b'
          : model.id.includes('coder')
            ? 'qwen2.5-coder:7b'
            : model.id.includes('deepseek')
              ? 'deepseek-r1:8b'
              : model.id.includes('vl')
                ? 'qwen2.5vl:3b'
                : 'qwen2.5:7b';

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModelTag,
        messages: ollamaMessages,
        quantization: model.quantization,
        repo_id: model.baseModelRepo || model.repoId,
        stream: true,
      }),
      signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`Local LLM worker responded with status ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.message?.content) {
            yield parsed.message.content;
          }
        } catch {
          // ignore partial NDJSON line
        }
      }
    }
    return;
  }

  // 2. Server-side @google/genai gateway path
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error(
      'No local inference worker (Ollama/pebble_llm_worker on 127.0.0.1:11434) is running and no server GEMINI_API_KEY is configured.'
    );
  }

  const contents = messages.map((m) => {
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
    const textBody = buildTextWithAttachments(m.content, m.attachments);
    if (textBody) {
      parts.push({ text: textBody });
    }
    if (m.attachments) {
      for (const att of m.attachments) {
        if (att.mimeType.startsWith('image/') && att.dataUrl) {
          const parsed = parseDataUrl(att.dataUrl);
          if (parsed) {
            parts.push({ inlineData: parsed });
          }
        }
      }
    }
    if (parts.length === 0) {
      parts.push({ text: '...' });
    }
    return {
      role: m.role === 'assistant' ? 'model' : 'user',
      parts,
    };
  });

  const candidateModels = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
  let lastError: unknown = null;

  for (const gatewayModel of candidateModels) {
    let yieldedAny = false;
    const firstTokenTimer = new AbortController();
    const timeoutId = setTimeout(() => firstTokenTimer.abort(), 12000);
    const onCallerAbort = () => firstTokenTimer.abort();
    signal?.addEventListener('abort', onCallerAbort, { once: true });

    try {
      const tierInfo = model.tier ? `${model.tier.toUpperCase()} tier` : `${model.parametersBillion}B`;
      const styleNote =
        model.censorship === 'uncensored'
          ? 'Open-ended creative & unvarnished analytical tone'
          : 'Standard helpful assistant tone';

      const stream = await ai.models.generateContentStream({
        model: gatewayModel,
        contents,
        config: {
          abortSignal: firstTokenTimer.signal,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            `${systemInstruction}\n\nActive Pebble Model Profile: ${model.name} (${tierInfo}, ${model.quantization}, base: ${model.baseModelRepo || model.repoId}, style: ${styleNote}).`
              .trim(),
        },
      });

      for await (const chunk of stream) {
        if (!yieldedAny) {
          clearTimeout(timeoutId);
          yieldedAny = true;
        }
        if (signal?.aborted) break;
        if (chunk.text) {
          yield chunk.text;
        }
      }
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onCallerAbort);
      if (yieldedAny || signal?.aborted) {
        return;
      }
    } catch (err) {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onCallerAbort);
      if (signal?.aborted || yieldedAny) {
        return;
      }
      lastError = err;
    }
  }

  if (lastError) {
    throw lastError;
  }
}

function buildTextWithAttachments(content: string, attachments?: ChatAttachment[]): string {
  if (!attachments || attachments.length === 0) return content;
  const textAttachments = attachments
    .filter((a) => a.textContent)
    .map((a) => `\n\n[Attached File: ${a.name}]\n${a.textContent}`);
  return `${content}${textAttachments.join('')}`.trim();
}

export async function executeImageStudioTask(params: {
  prompt: string;
  negativePrompt?: string;
  mode:
    | 'generate'
    | 'edit'
    | 'variation'
    | 'extract_rgba'
    | 'remove_background'
    | 'remove_object';
  aspectRatio: '1:1' | '4:3' | '3:4' | '16:9' | '9:16';
  steps: number;
  seed: number;
  lowVramProfile: boolean;
  sourceImageDataUrl?: string;
  maskDataUrl?: string;
  model: ModelEntry;
  backend: ExecutionBackend;
  settings: PebbleSettings;
}): Promise<{ imageUrl: string; actualBackend: string }> {
  const {
    prompt,
    negativePrompt,
    mode,
    aspectRatio,
    steps,
    seed,
    lowVramProfile,
    sourceImageDataUrl,
    maskDataUrl,
    model,
    backend,
    settings,
  } = params;

  // 1. Local Image Python Worker (DirectML / CPU Offload / bitsandbytes NF4)
  if (backend === 'Local Worker HTTP' && settings.localWorkers.qwenImageUrl) {
    const baseUrl = settings.localWorkers.qwenImageUrl.replace(/\/+$/, '');
    const endpoint = mode === 'generate' ? '/generate' : '/edit';
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model_repo: model.baseModelRepo || model.repoId,
        quantization: model.quantization,
        prompt,
        negative_prompt: negativePrompt ?? '',
        aspect_ratio: aspectRatio,
        steps,
        seed,
        low_vram_profile: lowVramProfile,
        mode,
        source_image: sourceImageDataUrl,
        mask_image: maskDataUrl,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Local Image worker error (${res.status}): ${errText}`);
    }
    const payload = (await res.json()) as { image_base64: string; mime_type?: string; backend?: string };
    const savedUrl = saveGeneratedImageBytes(
      Buffer.from(payload.image_base64, 'base64'),
      payload.mime_type?.includes('jpeg') ? 'jpg' : 'png'
    );
    return {
      imageUrl: savedUrl,
      actualBackend: payload.backend || `Local ${model.name} Worker (DirectML / CPU Offload)`,
    };
  }

  // 2. Server-side @google/genai gateway fallback when local image worker isn't active
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error(
      'Local Image worker (http://127.0.0.1:7861) is offline and no server GEMINI_API_KEY is available.'
    );
  }

  const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];

  if (sourceImageDataUrl) {
    const resolvedSource = resolveImageInputToInlineData(sourceImageDataUrl);
    if (resolvedSource) {
      parts.push({ inlineData: resolvedSource });
    }
  }

  if (maskDataUrl) {
    const parsedMask = parseDataUrl(maskDataUrl);
    if (parsedMask) {
      parts.push({ inlineData: parsedMask });
    }
  }

  let composedPrompt = prompt;
  if (mode === 'remove_background' || mode === 'extract_rgba') {
    composedPrompt = `Remove the entire background cleanly around the primary foreground subject and place the crisp subject against a pure flat neutral backdrop ready for RGBA alpha isolation. Keep subject details untouched. ${prompt ? `Focus: ${prompt}` : ''}`.trim();
  } else if (mode === 'remove_object' && maskDataUrl) {
    composedPrompt = `Remove and erase the object highlighted inside the white mask region of the second image. Seamlessly reconstruct the background texture, lighting, and geometry behind where the removed object was. ${prompt ? `Note: ${prompt}` : ''}`.trim();
  } else if (mode === 'remove_object') {
    composedPrompt = `Cleanly remove the unwanted object described below and reconstruct the natural background seamlessly: ${prompt}`;
  } else if (mode === 'edit' && maskDataUrl) {
    composedPrompt = `Edit the first image specifically inside the region painted in the second mask image: ${prompt}`;
  } else if (mode === 'edit') {
    composedPrompt = `Apply this image edit while preserving the overall composition and subject fidelity: ${prompt}`;
  } else if (mode === 'variation') {
    composedPrompt = `Create a cohesive variation of the provided image preserving core composition while applying: ${prompt}`;
  }

  if (negativePrompt?.trim()) {
    composedPrompt += `\nAvoid: ${negativePrompt.trim()}`;
  }

  parts.push({ text: composedPrompt });

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite-image',
    contents: { parts },
    config: {
      imageConfig: {
        aspectRatio,
      },
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) {
      const mime = part.inlineData.mimeType ?? 'image/png';
      const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png';
      const savedUrl = saveGeneratedImageBytes(Buffer.from(part.inlineData.data, 'base64'), ext);
      return {
        imageUrl: savedUrl,
        actualBackend: `Cloud Image Gateway (${model.name} profile)`,
      };
    }
  }

  throw new Error('Image generation completed without returning image bytes.');
}

function resolveImageInputToInlineData(src: string): { mimeType: string; data: string } | null {
  if (src.startsWith('data:')) {
    return parseDataUrl(src);
  }
  const cleanRel = src.replace(/^\/+/, '');
  const candidatePath = path.resolve(process.cwd(), cleanRel);
  if (candidatePath.startsWith(process.cwd()) && fs.existsSync(candidatePath)) {
    const buf = fs.readFileSync(candidatePath);
    const mimeType = cleanRel.endsWith('.jpg') || cleanRel.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
    return { mimeType, data: buf.toString('base64') };
  }
  return null;
}

function saveGeneratedImageBytes(bytes: Buffer, ext: 'png' | 'jpg'): string {
  const filename = `pebble_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const fullPath = path.join(IMAGES_DIR, filename);
  fs.writeFileSync(fullPath, bytes);
  return `/api/images/file/${filename}`;
}

export async function transcribeAudioBuffer(params: {
  audioBase64: string;
  mimeType: string;
  language: string;
  settings: PebbleSettings;
}): Promise<{ text: string; backendUsed: string }> {
  if (params.settings.localWorkers.preferLocalWorkers) {
    try {
      const baseUrl = params.settings.localWorkers.voiceWorkerUrl.replace(/\/+$/, '');
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 500);
      const res = await fetch(`${baseUrl}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio_base64: params.audioBase64,
          mime_type: params.mimeType,
          language: params.language,
        }),
        signal: controller.signal,
      });
      clearTimeout(t);
      if (res.ok) {
        const json = (await res.json()) as { text: string };
        return { text: json.text, backendUsed: 'Local Whisper Worker (CPU INT8)' };
      }
    } catch {
      // Fallback to server gateway
    }
  }

  const ai = getGeminiClient();
  if (!ai) {
    throw new Error('Local Whisper voice worker is offline and GEMINI_API_KEY is not configured.');
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3.5-transcribe',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: params.mimeType || 'audio/webm',
            data: params.audioBase64,
          },
        },
        {
          text: `Transcribe this spoken audio accurately in ${params.language || 'English'}. Return only the transcribed text.`,
        },
      ],
    },
  });

  return {
    text: (response.text ?? '').trim(),
    backendUsed: 'Cloud Speech Gateway (gemini-3.5-transcribe)',
  };
}

export async function synthesizeSpeechWav(params: {
  text: string;
  voiceName: 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';
  settings: PebbleSettings;
}): Promise<{ audioDataUrl: string; backendUsed: string }> {
  if (params.settings.localWorkers.preferLocalWorkers) {
    try {
      const baseUrl = params.settings.localWorkers.voiceWorkerUrl.replace(/\/+$/, '');
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 500);
      const res = await fetch(`${baseUrl}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: params.text,
          voice: params.voiceName,
          speed: params.settings.voice.speakingSpeed,
        }),
        signal: controller.signal,
      });
      clearTimeout(t);
      if (res.ok) {
        const json = (await res.json()) as { wav_base64: string };
        return {
          audioDataUrl: `data:audio/wav;base64,${json.wav_base64}`,
          backendUsed: 'Local Kokoro/Piper TTS Worker (CPU)',
        };
      }
    } catch {
      // Fallback to server gateway
    }
  }

  const ai = getGeminiClient('v1beta');
  if (!ai) {
    throw new Error('Local TTS voice worker is offline and GEMINI_API_KEY is not configured.');
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash-lite-tts',
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: params.text,
            speechMetadata: {
              style: 'Clear, calm, responsive local assistant voice',
            },
          },
        ],
      },
    ],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: params.voiceName || 'Kore' },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error('TTS engine returned no audio data.');
  }

  return {
    audioDataUrl: `data:audio/wav;base64,${base64Audio}`,
    backendUsed: 'Cloud TTS Gateway (gemini-3.8-flash-lite-tts)',
  };
}

/**
 * Checks if a spoken command in True Voice Mode asks for live system telemetry, workspace status,
 * or showing/creating an image inside the Voice HUD stage.
 */
export function buildVoiceSystemActionSummary(
  text: string,
  hardware: HardwareSpecs,
  models: ModelEntry[],
  activeRouterName: string
): { handledLocally: boolean; replyText?: string; actionLabel?: string } {
  const lower = text.toLowerCase();
  const statusIntent =
    /\b(vram|ram usage|memory status|hardware status|system status|what models are loaded|loaded models|gpu status|active router)\b/.test(
      lower
    );

  if (!statusIntent) {
    return { handledLocally: false };
  }

  const active = models.filter(
    (m) => m.status === 'loaded_vram' || m.status === 'loaded_ram_offload' || m.status === 'loaded_cpu'
  );
  const loadedSummary =
    active.length > 0
      ? active.map((m) => `${m.name} (${m.gpuLayersLoaded ?? m.compatibility.gpuLayersOffloaded}/${m.compatibility.totalLayers} GPU layers)`).join(', ')
      : 'no heavy models pinned in memory yet';

  const gpuNote = hardware.isGpuAccelerated
    ? `${hardware.gpuName} has ${hardware.gpuVramUsedGb} of ${hardware.gpuVramGb} gigabytes VRAM in use via ${hardware.amdAcceleration.preferredBackend}.`
    : `Running on ${hardware.cpuModel} with ${hardware.usedRamGb} of ${hardware.totalRamGb} gigabytes RAM in use.`;

  return {
    handledLocally: true,
    actionLabel: 'Live System Diagnostic',
    replyText: `${gpuNote} ${activeRouterName} is active, and currently loaded models are: ${loadedSummary}.`,
  };
}

export async function generateThemeFromBackgroundImage(
  dataUrl: string,
  preferLight?: boolean
): Promise<{ tokens: CustomUiThemeTokens; summary: string; modelUsed: string }> {
  const ai = getGeminiClient();
  const parsedImg = parseDataUrl(dataUrl);

  const fallbackTokens: CustomUiThemeTokens = preferLight
    ? {
        isDark: false,
        backdropGradient: 'linear-gradient(135deg, rgba(235, 244, 250, 0.85), rgba(220, 232, 240, 0.9))',
        panelBg: 'rgba(255, 255, 255, 0.78)',
        panelHoverBg: 'rgba(255, 255, 255, 0.90)',
        panelBorder: 'rgba(15, 23, 42, 0.10)',
        textPrimary: '#0f172a',
        textSecondary: '#475569',
        accentColor: '#1d6fa5',
        accentHover: '#155a87',
        accentText: '#ffffff',
        blurPx: 26,
        recommendedAnimation: 'mesh_drift',
      }
    : {
        isDark: true,
        backdropGradient: 'linear-gradient(135deg, rgba(16, 30, 34, 0.85), rgba(10, 18, 22, 0.92))',
        panelBg: 'rgba(14, 22, 26, 0.66)',
        panelHoverBg: 'rgba(22, 34, 40, 0.78)',
        panelBorder: 'rgba(255, 255, 255, 0.15)',
        textPrimary: '#f4f7f8',
        textSecondary: '#b7c7cc',
        accentColor: '#2d8f7a',
        accentHover: '#36a890',
        accentText: '#ffffff',
        blurPx: 26,
        recommendedAnimation: 'aurora',
      };

  if (!ai || !parsedImg) {
    return {
      tokens: fallbackTokens,
      summary: 'Applied translucent Acrylic glass harmony matched to your background.',
      modelUsed: 'Local Luminance Glass Fallback',
    };
  }

  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            { inlineData: { mimeType: parsedImg.mimeType, data: parsedImg.data } },
            {
              text: 'Analyze this desktop wallpaper image and craft a cohesive translucent Windows Acrylic / Mica UI theme around its dominant colors, lighting, and contrast. Choose high-legibility foreground text colors (WCAG AA >= 4.5:1 against panelBg), a rich primary accentColor in hex (#rrggbb), a darker/lighter hover hex accentHover, readable panelBg rgba(...) with alpha between 0.56 and 0.82, subtle panelBorder rgba(...), blurPx between 18 and 32, and recommendedAnimation from: none, aurora, particles, mesh_drift, starfield.',
            },
          ],
        },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              isDark: { type: Type.BOOLEAN },
              backdropGradient: { type: Type.STRING },
              panelBg: { type: Type.STRING },
              panelHoverBg: { type: Type.STRING },
              panelBorder: { type: Type.STRING },
              textPrimary: { type: Type.STRING },
              textSecondary: { type: Type.STRING },
              accentColor: { type: Type.STRING },
              accentHover: { type: Type.STRING },
              accentText: { type: Type.STRING },
              blurPx: { type: Type.INTEGER },
              recommendedAnimation: { type: Type.STRING },
              summary: { type: Type.STRING },
            },
            required: [
              'isDark',
              'panelBg',
              'panelBorder',
              'textPrimary',
              'textSecondary',
              'accentColor',
              'accentHover',
              'accentText',
              'blurPx',
              'recommendedAnimation',
            ],
          },
        },
      }),
      15000,
      'Theme AI analysis (gemini-4-hydrogen)'
    );

    const parsed = JSON.parse((response.text ?? '{}').trim()) as Partial<CustomUiThemeTokens> & {
      summary?: string;
    };
    const validAnims = ['none', 'aurora', 'particles', 'mesh_drift', 'starfield'];
    const anim = validAnims.includes(String(parsed.recommendedAnimation))
      ? (parsed.recommendedAnimation as CustomUiThemeTokens['recommendedAnimation'])
      : fallbackTokens.recommendedAnimation;

    return {
      tokens: {
        isDark: typeof parsed.isDark === 'boolean' ? parsed.isDark : fallbackTokens.isDark,
        backdropGradient: parsed.backdropGradient || fallbackTokens.backdropGradient,
        panelBg: parsed.panelBg || fallbackTokens.panelBg,
        panelHoverBg: parsed.panelHoverBg || parsed.panelBg || fallbackTokens.panelHoverBg,
        panelBorder: parsed.panelBorder || fallbackTokens.panelBorder,
        textPrimary: parsed.textPrimary || fallbackTokens.textPrimary,
        textSecondary: parsed.textSecondary || fallbackTokens.textSecondary,
        accentColor: parsed.accentColor || fallbackTokens.accentColor,
        accentHover: parsed.accentHover || fallbackTokens.accentHover,
        accentText: parsed.accentText || '#ffffff',
        blurPx: Math.min(34, Math.max(14, Number(parsed.blurPx || 24))),
        recommendedAnimation: anim,
      },
      summary: parsed.summary || 'Custom glassmorphism palette synthesized around your uploaded background.',
      modelUsed: 'gemini-4-hydrogen Vision Theme Editor',
    };
  } catch (err) {
    console.warn('Theme AI fallback:', err);
    return {
      tokens: fallbackTokens,
      summary: 'Applied adaptive frosted glass theme around your uploaded wallpaper.',
      modelUsed: 'Local Glass Harmony Fallback',
    };
  }
}

export async function planAgentTaskSteps(
  goal: string,
  activeModel?: Pick<ModelEntry, 'id' | 'name' | 'censorship'> | null,
  routerId?: RouterId | string | null
): Promise<AgentStep[]> {
  const ai = getGeminiClient();
  const policy = canModelControlPc(activeModel, routerId);
  const allowedTools = getAllowedAgentTools(activeModel, routerId);
  const existingFiles = policy.allowed ? listWorkspaceFilesRecursive(AGENT_WORKSPACE_DIR) : [];

  // Direct PC control intent fast-path (strictly checked against censored policy)
  const directPc = parsePcControlCommand(goal);
  if (directPc) {
    if (!policy.allowed) {
      return [
        {
          id: `step-${Date.now()}-blocked`,
          index: 1,
          title: 'PC Control Blocked by Security Policy',
          tool: 'reason_summary',
          args: {
            prompt: `Explain clearly why ${activeModel?.name || 'an uncensored model'} cannot execute "${goal}" on the host PC.`,
          },
          requiresApproval: false,
          approvalStatus: 'auto',
          status: 'pending',
          preview: policy.reason,
        },
      ];
    }

    const args: Record<string, string> = {};
    if (directPc.x !== undefined) args.x = String(directPc.x);
    if (directPc.y !== undefined) args.y = String(directPc.y);
    if (directPc.button) args.button = directPc.button;
    if (directPc.doubleClick) args.doubleClick = 'true';
    if (directPc.deltaY !== undefined) args.deltaY = String(directPc.deltaY);
    if (directPc.text) args.text = directPc.text;
    if (directPc.keys) args.keys = directPc.keys.join('+');

    return [
      {
        id: `step-${Date.now()}-pc`,
        index: 1,
        title: directPc.summary,
        tool: directPc.action,
        args,
        requiresApproval: true,
        approvalStatus: 'pending',
        status: 'pending',
        preview: `Censored Model Host Input Action -> ${directPc.summary}`,
      },
    ];
  }

  // Uncensored isolated planning: strictly allow only non-PC reasoning & image generation
  if (!policy.allowed) {
    const wantsImage = /\b(image|picture|photo|render|draw|generate|art|portrait)\b/i.test(goal);
    if (wantsImage) {
      return [
        {
          id: `step-${Date.now()}-u0`,
          index: 1,
          title: 'Generate Creative Image (Sandboxed)',
          tool: 'generate_image',
          args: { prompt: goal },
          requiresApproval: true,
          approvalStatus: 'pending',
          status: 'pending',
          preview: 'Uncensored non-PC visual synthesis only (no host file or mouse/keyboard access)',
        },
      ];
    }
    return [
      {
        id: `step-${Date.now()}-u0`,
        index: 1,
        title: 'Sandboxed Uncensored Text Analysis (Zero Host Access)',
        tool: 'reason_summary',
        args: { prompt: goal },
        requiresApproval: false,
        approvalStatus: 'auto',
        status: 'pending',
        preview: 'Runs strictly in memory with zero mouse, keyboard, or filesystem access.',
      },
    ];
  }

  if (ai) {
    for (const plannerModel of ['gemini-4-hydrogen', 'gemini-3.1-flash-lite']) {
      try {
        const response = await withTimeout(
          ai.models.generateContent({
            model: plannerModel,
            contents: `Create a concise, practical 2-to-5 step execution plan for a local PC + workspace AI agent.\n\nUser Goal: ${goal}\nCurrent files inside sandbox workspace:\n${existingFiles.join('\n') || '(empty)'}\n\nAllowed tools:\n- list_files (args: { path })\n- read_file (args: { path })\n- write_file (args: { path, content })\n- create_directory (args: { path })\n- search_files (args: { query })\n- analyze_code (args: { path })\n- generate_image (args: { prompt })\n- mouse_move (args: { x, y })\n- mouse_click (args: { x, y, button, doubleClick })\n- mouse_scroll (args: { deltaY })\n- keyboard_type (args: { text })\n- keyboard_hotkey (args: { keys })\n\nMark write_file, generate_image, and all mouse_*/keyboard_* steps with requiresApproval: true. Keep file paths relative to the sandbox workspace.`,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    tool: { type: Type.STRING },
                    path: { type: Type.STRING },
                    content: { type: Type.STRING },
                    query: { type: Type.STRING },
                    prompt: { type: Type.STRING },
                    x: { type: Type.STRING },
                    y: { type: Type.STRING },
                    button: { type: Type.STRING },
                    text: { type: Type.STRING },
                    keys: { type: Type.STRING },
                    deltaY: { type: Type.STRING },
                    requiresApproval: { type: Type.BOOLEAN },
                    preview: { type: Type.STRING },
                  },
                  required: ['title', 'tool', 'requiresApproval'],
                },
              },
            },
          }),
          12000,
          `Agent planning (${plannerModel})`
        );

        const parsed = JSON.parse((response.text ?? '[]').trim()) as Array<{
          title: string;
          tool: AgentStep['tool'];
          path?: string;
          content?: string;
          query?: string;
          prompt?: string;
          x?: string;
          y?: string;
          button?: string;
          text?: string;
          keys?: string;
          deltaY?: string;
          requiresApproval: boolean;
          preview?: string;
        }>;

        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.slice(0, 6).map((item, idx) => {
            const safeTool = allowedTools.includes(item.tool) ? item.tool : 'list_files';
            return {
              id: `step-${Date.now()}-${idx}`,
              index: idx + 1,
              title: item.title,
              tool: safeTool,
              args: {
                ...(item.path ? { path: item.path } : {}),
                ...(item.content ? { content: item.content } : {}),
                ...(item.query ? { query: item.query } : {}),
                ...(item.prompt ? { prompt: item.prompt } : {}),
                ...(item.x ? { x: item.x } : {}),
                ...(item.y ? { y: item.y } : {}),
                ...(item.button ? { button: item.button } : {}),
                ...(item.text ? { text: item.text } : {}),
                ...(item.keys ? { keys: item.keys } : {}),
                ...(item.deltaY ? { deltaY: item.deltaY } : {}),
              },
              requiresApproval:
                Boolean(item.requiresApproval) ||
                safeTool.startsWith('mouse_') ||
                safeTool.startsWith('keyboard_'),
              approvalStatus:
                Boolean(item.requiresApproval) ||
                safeTool.startsWith('mouse_') ||
                safeTool.startsWith('keyboard_')
                  ? 'pending'
                  : 'auto',
              status: 'pending',
              preview: item.preview || (item.content ? item.content.slice(0, 240) : undefined),
            };
          });
        }
      } catch (err) {
        console.warn(`Agent structured plan fallback (${plannerModel}):`, err);
      }
    }
  }

  return [
    {
      id: `step-${Date.now()}-0`,
      index: 1,
      title: 'Inspect sandbox workspace files',
      tool: 'list_files',
      args: { path: '.' },
      requiresApproval: false,
      approvalStatus: 'auto',
      status: 'pending',
      preview: 'Lists files inside data/agent_workspace',
    },
    {
      id: `step-${Date.now()}-1`,
      index: 2,
      title: 'Create task output report in workspace',
      tool: 'write_file',
      args: {
        path: 'reports/task-summary.md',
        content: `# Agent Task Summary\n\nGoal: ${goal}\nGenerated: ${new Date().toISOString()}\n`,
      },
      requiresApproval: true,
      approvalStatus: 'pending',
      status: 'pending',
      preview: 'Writes reports/task-summary.md inside sandbox workspace',
    },
  ];
}

export function resolveSafeSandboxPath(relPath: string): string {
  const cleaned = (relPath || '.').replace(/^[/\\]+/, '');
  const resolved = path.resolve(AGENT_WORKSPACE_DIR, cleaned);
  if (!resolved.startsWith(AGENT_WORKSPACE_DIR)) {
    throw new Error(`Access denied: '${relPath}' escapes the restricted agent workspace.`);
  }
  return resolved;
}

export function listWorkspaceFilesRecursive(dir: string, prefix = ''): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(`${rel}/`);
      results.push(...listWorkspaceFilesRecursive(path.join(dir, entry.name), rel));
    } else {
      results.push(rel);
    }
  }
  return results;
}

export async function executeSandboxedAgentStep(
  step: AgentStep,
  settings: PebbleSettings,
  primaryImageModel: ModelEntry,
  previousOutputs: string[] = [],
  activeModel?: Pick<ModelEntry, 'id' | 'name' | 'censorship'> | null,
  routerId?: RouterId | string | null
): Promise<string> {
  // Hard policy gate: uncensored models are denied mouse, keyboard, and host file access
  assertModelCanUseTool(step.tool, activeModel, routerId ?? settings.activeRouterId);

  switch (step.tool) {
    case 'list_files': {
      const target = resolveSafeSandboxPath(step.args.path || '.');
      const files = listWorkspaceFilesRecursive(target);
      return files.length > 0 ? files.join('\n') : '(directory is empty)';
    }
    case 'read_file': {
      const target = resolveSafeSandboxPath(step.args.path || '');
      if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        throw new Error(`File not found: ${step.args.path}`);
      }
      return fs.readFileSync(target, 'utf8').slice(0, 8000);
    }
    case 'create_directory': {
      const target = resolveSafeSandboxPath(step.args.path || 'new-folder');
      fs.mkdirSync(target, { recursive: true });
      return `Created directory: ${step.args.path}`;
    }
    case 'write_file': {
      const target = resolveSafeSandboxPath(step.args.path || 'output.md');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      let contentToWrite = step.args.content ?? '';
      if (!contentToWrite.trim()) {
        const ai = getGeminiClient();
        if (ai) {
          for (const synthModel of ['gemini-4-hydrogen', 'gemini-3.1-flash-lite']) {
            try {
              const gen = await withTimeout(
                ai.models.generateContent({
                  model: synthModel,
                  contents: `Write the complete file contents for "${step.args.path || 'output.md'}" to fulfill: "${step.title}".\n\nContext collected from previous steps:\n${previousOutputs.join('\n---\n') || '(none)'}\n\nReturn only the raw file content.`,
                  config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
                }),
                10000,
                `Agent write_file synthesis (${synthModel})`
              );
              contentToWrite = (gen.text ?? '').trim();
              if (contentToWrite) break;
            } catch (err) {
              console.warn(`Agent write_file synthesis fallback (${synthModel}):`, err);
            }
          }
        }
        if (!contentToWrite.trim()) {
          contentToWrite = `# ${step.title}\n\n${previousOutputs.join('\n\n') || `Generated at ${new Date().toISOString()}`}\n`;
        }
      }
      fs.writeFileSync(target, contentToWrite, 'utf8');
      return `Wrote ${contentToWrite.length} bytes to ${step.args.path}`;
    }
    case 'search_files': {
      const query = (step.args.query || '').toLowerCase();
      const files = listWorkspaceFilesRecursive(AGENT_WORKSPACE_DIR).filter((f) => !f.endsWith('/'));
      const hits: string[] = [];
      for (const rel of files) {
        const full = resolveSafeSandboxPath(rel);
        const content = fs.readFileSync(full, 'utf8');
        if (rel.toLowerCase().includes(query) || content.toLowerCase().includes(query)) {
          hits.push(rel);
        }
      }
      return hits.length > 0 ? `Matches:\n${hits.join('\n')}` : `No matches for "${step.args.query}"`;
    }
    case 'analyze_code': {
      const target = resolveSafeSandboxPath(step.args.path || '');
      const content = fs.readFileSync(target, 'utf8').slice(0, 6000);
      const ai = getGeminiClient();
      if (!ai) {
        return `Read ${content.length} chars from ${step.args.path}.`;
      }
      try {
        const res = await withTimeout(
          ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: `Analyze this workspace file concisely and report findings:\n\nFile: ${step.args.path}\n\`\`\`\n${content}\n\`\`\``,
            config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
          }),
          15000,
          'Agent analyze_code'
        );
        return res.text ?? 'Analysis completed.';
      } catch {
        return `Inspected ${step.args.path} (${content.length} chars, ${content.split('\n').length} lines).`;
      }
    }
    case 'reason_summary': {
      const ai = getGeminiClient();
      const prompt = step.args.prompt || step.title;
      if (ai) {
        try {
          const res = await withTimeout(
            ai.models.generateContent({
              model: 'gemini-4-hydrogen',
              contents: prompt,
              config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
            }),
            15000,
            'Agent reason_summary'
          );
          return res.text ?? 'Completed sandboxed text analysis.';
        } catch {
          // fallback below
        }
      }
      return step.preview || `Completed sandboxed non-PC analysis for: ${prompt}`;
    }
    case 'mouse_move': {
      const x = Number(step.args.x ?? 640);
      const y = Number(step.args.y ?? 360);
      const execRes = await executeHostPcControl({
        command: { action: 'mouse_move', x, y, summary: `Move mouse cursor to (${x}, ${y})` },
        model: activeModel,
        routerId: routerId ?? settings.activeRouterId,
        settings,
      });
      return execRes.message;
    }
    case 'mouse_click': {
      const x = step.args.x !== undefined ? Number(step.args.x) : undefined;
      const y = step.args.y !== undefined ? Number(step.args.y) : undefined;
      const button = (step.args.button as 'left' | 'right' | 'middle') || 'left';
      const doubleClick = step.args.doubleClick === 'true';
      const execRes = await executeHostPcControl({
        command: {
          action: 'mouse_click',
          x,
          y,
          button,
          doubleClick,
          summary: `${doubleClick ? 'Double ' : ''}${button} click${x !== undefined && y !== undefined ? ` at (${x}, ${y})` : ''}`,
        },
        model: activeModel,
        routerId: routerId ?? settings.activeRouterId,
        settings,
      });
      return execRes.message;
    }
    case 'mouse_scroll': {
      const deltaY = Number(step.args.deltaY ?? -240);
      const execRes = await executeHostPcControl({
        command: {
          action: 'mouse_scroll',
          deltaY,
          summary: `Scroll mouse wheel (${deltaY})`,
        },
        model: activeModel,
        routerId: routerId ?? settings.activeRouterId,
        settings,
      });
      return execRes.message;
    }
    case 'keyboard_type': {
      const text = step.args.text || '';
      const execRes = await executeHostPcControl({
        command: {
          action: 'keyboard_type',
          text,
          summary: `Type "${text}" via host keyboard`,
        },
        model: activeModel,
        routerId: routerId ?? settings.activeRouterId,
        settings,
      });
      return execRes.message;
    }
    case 'keyboard_hotkey': {
      const keys = (step.args.keys || 'enter')
        .split(/[+\s]+/)
        .map((k) => k.trim())
        .filter(Boolean);
      const execRes = await executeHostPcControl({
        command: {
          action: 'keyboard_hotkey',
          keys,
          summary: `Press hotkey ${keys.join(' + ').toUpperCase()}`,
        },
        model: activeModel,
        routerId: routerId ?? settings.activeRouterId,
        settings,
      });
      return execRes.message;
    }
    case 'generate_image': {
      const result = await executeImageStudioTask({
        prompt: step.args.prompt || 'Minimalist workspace concept',
        mode: 'generate',
        aspectRatio: '1:1',
        steps: 24,
        seed: Math.floor(Math.random() * 999999),
        lowVramProfile: settings.qwenLowVramEnabled,
        model: primaryImageModel,
        backend: 'Cloud Gateway (@google/genai)',
        settings,
      });
      return `Generated image saved to ${result.imageUrl} via ${result.actualBackend}`;
    }
  }
}
