import type {
  ExecutionBackend,
  ModelEntry,
  ModelTaskProfile,
  OmniMode,
  RouterId,
} from './types';

export interface RouterProfileDefinition {
  id: RouterId;
  name: string;
  tagline: string;
  description: string;
  preferredQuantizations: string[];
  allowsUncensored: boolean;
  prioritizesAmdVram: boolean;
}

export const ROUTER_PROFILES: RouterProfileDefinition[] = [
  {
    id: 'omni',
    name: 'Pebble Omni',
    tagline: 'Flagship intelligent task + hardware router',
    description:
      'Classifies prompt intent (Chat, Coding, Reasoning, Vision, Image Studio, Voice) and dynamically routes across all Pebble AI Tiny/Small/Normal/Ultra and specialist models while balancing 4GB VRAM and 40GB RAM.',
    preferredQuantizations: ['Q4_K_M', 'AWQ', 'BNB_NF4', 'INT8_OFFLOAD'],
    allowsUncensored: true,
    prioritizesAmdVram: true,
  },
  {
    id: 'amd_hardware',
    name: 'AMD Hardware-Aware Router',
    tagline: 'RX 6500M Vulkan / DirectML tight-VRAM governor',
    description:
      'Maximizes token throughput and stability on 4GB RDNA 2 VRAM by preferring AWQ, GPTQ, NF4, and Tiny/Small/Normal Pebble AI models that fit cleanly into Vulkan Compute or low-overhead DirectML offload.',
    preferredQuantizations: ['AWQ', 'GPTQ', 'BNB_NF4', 'Q4_K_M'],
    allowsUncensored: false,
    prioritizesAmdVram: true,
  },
  {
    id: 'uncensored',
    name: 'Uncensored Creative Router',
    tagline: 'Unfiltered Pebble AI Chat & Image policy router',
    description:
      'Routes prompts preferentially to Uncensored variants of Pebble AI Tiny, Small, Normal, and Ultra models across both text and image generation with zero refusal filtering.',
    preferredQuantizations: ['BNB_NF4', 'AWQ', 'GPTQ', 'Q4_K_M'],
    allowsUncensored: true,
    prioritizesAmdVram: true,
  },
  {
    id: 'edge_voice',
    name: 'Low-Latency Edge & Voice Router',
    tagline: 'Sub-second Tiny/Small voice & quick-draft router',
    description:
      'Targets Pebble AI Tiny and Small models that execute 100% resident in GPU/CPU cache for hands-free Voice Mode, rapid brainstorming, and multi-device LAN responsiveness.',
    preferredQuantizations: ['Q4_K_M', 'AWQ', 'BNB_NF4'],
    allowsUncensored: false,
    prioritizesAmdVram: true,
  },
];

export function getRouterProfile(routerId?: RouterId): RouterProfileDefinition {
  return ROUTER_PROFILES.find((r) => r.id === routerId) ?? ROUTER_PROFILES[0];
}

export interface RouteIntentInput {
  prompt: string;
  hasImageAttachment?: boolean;
  hasAudioAttachment?: boolean;
  forceTask?: ModelTaskProfile;
  manualModelId?: string;
  routerId?: RouterId;
  mode: OmniMode;
  allowUncensoredModels?: boolean;
  preferredQuantization?: string;
  models: ModelEntry[];
  preferLocalWorkers: boolean;
  activeWorkers: {
    ollama: boolean;
    qwenImage: boolean;
    voice: boolean;
    cloudGateway: boolean;
  };
}

export interface RouteResolution {
  routerId: RouterId;
  routerName: string;
  detectedTask: ModelTaskProfile;
  selectedModel: ModelEntry;
  backendUsed: ExecutionBackend;
  reasoning: string;
}

/**
 * Classifies a user request into one of Pebble AI's task profiles using
 * deterministic intent heuristics.
 */
export function classifyUserTask(
  prompt: string,
  options?: { hasImageAttachment?: boolean; hasAudioAttachment?: boolean; forceTask?: ModelTaskProfile }
): ModelTaskProfile {
  if (options?.forceTask) return options.forceTask;
  if (options?.hasAudioAttachment) return 'speech_recognition';

  const text = prompt.toLowerCase().trim();

  if (options?.hasImageAttachment) {
    const editKeywords = [
      'edit',
      'remove',
      'replace',
      'mask',
      'inpaint',
      'background',
      'transparent',
      'rgba',
      'extract',
      'expand',
      'outpaint',
      'add ',
      'change ',
    ];
    if (editKeywords.some((kw) => text.includes(kw))) {
      return 'image_editing';
    }
    return 'vision';
  }

  const imageGenPatterns = [
    /\b(generate|create|make|draw|render|paint|design|illustrate|show me a picture)\b.*\b(image|picture|photo|photograph|portrait|illustration|artwork|logo|poster|wallpaper|scene|city|landscape|diagram)\b/,
    /^(imagine|picture of|photo of|render of)\b/,
    /\bqwen image\b|\bpebble image\b/,
  ];
  if (imageGenPatterns.some((re) => re.test(text))) {
    return 'image_generation';
  }

  const ttsPatterns = [
    /\b(read aloud|speak|read this|say aloud|voice output|narrate|text to speech|tts)\b/,
  ];
  if (ttsPatterns.some((re) => re.test(text))) {
    return 'speech_generation';
  }

  const codingPatterns = [
    /\b(python|typescript|javascript|rust|c\+\+|sql|bash|powershell|html|css|react|docker|git|traceback|exception|stack trace|syntax error|compile|refactor|function|algorithm|regex|api endpoint|bug|debug)\b/,
    /```/,
  ];
  if (codingPatterns.some((re) => re.test(text))) {
    return 'coding';
  }

  const reasoningPatterns = [
    /\b(prove|derive|analyze|compare|trade-?offs?|architecture|step-by-step|math|equation|calculus|logic puzzle|evaluate|root cause|strategy)\b/,
  ];
  if (reasoningPatterns.some((re) => re.test(text))) {
    return 'reasoning';
  }

  return 'general_chat';
}

function estimatePromptComplexity(prompt: string): 'quick' | 'standard' | 'deep' {
  const len = prompt.trim().length;
  const lower = prompt.toLowerCase();
  if (
    len > 260 ||
    /\b(comprehensive|detailed|architecture|deep dive|multi-step|proof|system design|ultra|high resolution)\b/.test(
      lower
    )
  ) {
    return 'deep';
  }
  if (len < 45 && !/\b(why|how|explain|analyze|compare)\b/.test(lower)) {
    return 'quick';
  }
  return 'standard';
}

/**
 * Resolves which installed model and inference backend should serve a task
 * across all Pebble AI routers (Omni, AMD Hardware-Aware, Uncensored Creative, Edge & Voice)
 * and modes (Automatic, Balanced, Manual).
 */
export function resolveOmniRoute(input: RouteIntentInput): RouteResolution {
  const router = getRouterProfile(input.routerId);
  const detectedTask = classifyUserTask(input.prompt, {
    hasImageAttachment: input.hasImageAttachment,
    hasAudioAttachment: input.hasAudioAttachment,
    forceTask: input.forceTask,
  });

  if (input.mode === 'manual' && input.manualModelId) {
    const manualModel = input.models.find((m) => m.id === input.manualModelId);
    if (manualModel) {
      return {
        routerId: router.id,
        routerName: router.name,
        detectedTask,
        selectedModel: manualModel,
        backendUsed: pickBackendForModel(manualModel, input.preferLocalWorkers, input.activeWorkers),
        reasoning: `${router.name} (Manual): routed directly to ${manualModel.name}.`,
      };
    }
  }

  const allowUncensored =
    router.id === 'uncensored' ? true : (input.allowUncensoredModels ?? true);
  const installed = input.models.filter(
    (m) =>
      m.installed &&
      m.compatibility.tier !== 'Unsupported' &&
      (allowUncensored || m.censorship !== 'uncensored')
  );
  const pool = installed.length > 0 ? installed : input.models;
  const complexity = estimatePromptComplexity(input.prompt);
  const wantsUncensoredPrompt = /\b(uncensored|unfiltered|raw|abliterated|no filter)\b/i.test(input.prompt);

  const scored = pool
    .map((m) => {
      let score = 0;
      const supportsTask = m.supportedTasks.includes(detectedTask);
      if (supportsTask) score += 120;
      else score -= 180;

      if (m.assignedProfiles.includes(detectedTask)) score += 32;

      // Boost Pebble AI model family appropriately so Omni cleanly routes across Tiny/Small/Normal/Ultra
      if (m.isPebbleModel) score += 28;

      if (detectedTask === 'image_generation' || detectedTask === 'image_editing') {
        if (supportsTask && (m.tier === 'normal' || m.isPrimaryImageModel)) {
          score += 22;
        }
      }

      // Complexity tier alignment across Tiny / Small / Normal / Ultra
      if (router.id === 'edge_voice') {
        if (m.tier === 'tiny') score += 120;
        else if (m.tier === 'small') score += 95;
        else if (m.parametersBillion > 6) score -= 50;
      } else if (complexity === 'quick') {
        if (m.tier === 'tiny') score += 38;
        else if (m.tier === 'small') score += 26;
        else if (m.parametersBillion > 9) score -= 24;
      } else if (complexity === 'deep') {
        if (m.tier === 'ultra') score += 48;
        else if (m.tier === 'normal') score += 26;
      } else {
        if (m.tier === 'normal') score += 36;
        else if (m.tier === 'small') score += 16;
      }

      // Router-specific policies
      if (router.id === 'uncensored' || wantsUncensoredPrompt) {
        if (m.censorship === 'uncensored') score += 140;
        else if (m.censorship === 'censored') score -= 40;
      } else {
        // Default Omni/Hardware routers prefer Standard (censored) unless prompt asks for uncensored
        if (m.censorship === 'censored') score += 24;
      }

      if (router.id === 'amd_hardware') {
        score += Math.round(m.compatibility.systemFitScore * 0.55);
        if (!m.compatibility.requiresCpuOffload) score += 26;
      }

      if (input.preferredQuantization && input.preferredQuantization !== 'auto') {
        if (m.quantization.toUpperCase().includes(input.preferredQuantization.toUpperCase())) {
          score += 22;
        }
      }

      if (m.status !== 'unloaded') score += 18;

      if (input.mode === 'balanced') {
        if (m.compatibility.tier === 'Recommended') score += 28;
        if (m.parametersBillion <= 8) score += 15;
      } else {
        if (m.compatibility.tier === 'Recommended') score += 12;
        score += Math.min(20, m.parametersBillion * 1.2);
      }

      return { model: m, score };
    })
    .sort((a, b) => b.score - a.score);

  const selectedModel = scored[0]?.model ?? input.models[0];
  const backendUsed = pickBackendForModel(selectedModel, input.preferLocalWorkers, input.activeWorkers);

  const modeLabel = input.mode === 'balanced' ? 'Balanced' : 'Automatic';
  return {
    routerId: router.id,
    routerName: router.name,
    detectedTask,
    selectedModel,
    backendUsed,
    reasoning: `${router.name} (${modeLabel}) classified '${detectedTask.replace(/_/g, ' ')}' -> ${selectedModel.name} [${selectedModel.quantization}, ${selectedModel.compatibility.gpuLayersOffloaded}/${selectedModel.compatibility.totalLayers} GPU layers] via ${backendUsed}.`,
  };
}

export function pickBackendForModel(
  model: ModelEntry,
  preferLocalWorkers: boolean,
  activeWorkers: RouteIntentInput['activeWorkers']
): ExecutionBackend {
  const isImage =
    model.supportedTasks.includes('image_generation') ||
    model.supportedTasks.includes('image_editing');
  const isVoice =
    model.supportedTasks.includes('speech_recognition') ||
    model.supportedTasks.includes('speech_generation');

  if (preferLocalWorkers) {
    if (isImage && activeWorkers.qwenImage) return 'Local Worker HTTP';
    if (isVoice && activeWorkers.voice) return 'Local Worker HTTP';
    if (!isImage && !isVoice && activeWorkers.ollama) return 'Local Worker HTTP';
  }

  if (activeWorkers.cloudGateway) {
    return 'Cloud Gateway (@google/genai)';
  }

  return model.compatibility.recommendedBackend;
}
