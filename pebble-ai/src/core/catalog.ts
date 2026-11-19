import { applySystemBestMatchRecommendations, evaluateModelCompatibility } from './compatibility';
import type { CensorshipMode, HardwareSpecs, ModelEntry, PebbleModelTier } from './types';

export interface CatalogSeed {
  id: string;
  name: string;
  repoId: string;
  baseModelRepo?: string;
  family: string;
  description: string;
  parametersBillion: number;
  quantization: string;
  diskSizeGb: number;
  supportedTasks: ModelEntry['supportedTasks'];
  assignedProfiles: ModelEntry['assignedProfiles'];
  isPrimaryImageModel?: boolean;
  isPebbleModel?: boolean;
  tier?: PebbleModelTier;
  censorship?: CensorshipMode;
  noDownloadRequired?: boolean;
  installed: boolean;
  priority: ModelEntry['priority'];
}

export const DEFAULT_MODEL_CATALOG: CatalogSeed[] = [
  // =========================================================================
  // PEBBLE AI CHAT SUITE — Edited Open-Source Models (Standard & Uncensored)
  // Built-in / Instant Ready (noDownloadRequired: true)
  // =========================================================================
  {
    id: 'pebble-chat-tiny',
    name: 'Pebble AI Chat Tiny',
    repoId: 'pebble-ai/Pebble-Chat-Tiny-1.5B-Q4_K_M',
    baseModelRepo: 'Qwen/Qwen2.5-1.5B-Instruct',
    family: 'Pebble Chat (Tiny)',
    description:
      'Edited lightweight conversational & voice-fast derivative of Qwen2.5-1.5B. Runs 100% inside 4GB VRAM via Vulkan Compute with zero RAM spill.',
    parametersBillion: 1.5,
    quantization: 'Q4_K_M',
    diskSizeGb: 1.05,
    supportedTasks: ['general_chat', 'omni_routing'],
    assignedProfiles: ['omni_routing'],
    isPebbleModel: true,
    tier: 'tiny',
    censorship: 'censored',
    noDownloadRequired: true,
    installed: true,
    priority: 'high',
  },
  {
    id: 'pebble-chat-tiny-uncensored',
    name: 'Pebble AI Chat Tiny (Uncensored)',
    repoId: 'pebble-ai/Pebble-Chat-Tiny-1.5B-Uncensored-AWQ',
    baseModelRepo: 'Qwen/Qwen2.5-1.5B-Instruct',
    family: 'Pebble Chat (Tiny)',
    description:
      'Abliterated / refusal-free Pebble Chat Tiny edited from Qwen2.5-1.5B using AWQ 4-bit weights for ultra-fast private brainstorming.',
    parametersBillion: 1.5,
    quantization: 'AWQ',
    diskSizeGb: 1.02,
    supportedTasks: ['general_chat'],
    assignedProfiles: [],
    isPebbleModel: true,
    tier: 'tiny',
    censorship: 'uncensored',
    noDownloadRequired: true,
    installed: true,
    priority: 'normal',
  },
  {
    id: 'pebble-chat-small',
    name: 'Pebble AI Chat Small',
    repoId: 'pebble-ai/Pebble-Chat-Small-3B-AWQ',
    baseModelRepo: 'Qwen/Qwen2.5-3B-Instruct',
    family: 'Pebble Chat (Small)',
    description:
      'Edited compact daily assistant based on Qwen2.5-3B-Instruct with AWQ 4-bit quantization. Fits completely in RX 6500M 4GB VRAM with crisp responsiveness.',
    parametersBillion: 3.2,
    quantization: 'AWQ',
    diskSizeGb: 2.1,
    supportedTasks: ['general_chat', 'coding', 'vision'],
    assignedProfiles: [],
    isPebbleModel: true,
    tier: 'small',
    censorship: 'censored',
    noDownloadRequired: true,
    installed: true,
    priority: 'high',
  },
  {
    id: 'pebble-chat-small-uncensored',
    name: 'Pebble AI Chat Small (Uncensored)',
    repoId: 'pebble-ai/Pebble-Chat-Small-3B-Uncensored-GPTQ',
    baseModelRepo: 'Qwen/Qwen2.5-3B-Instruct',
    family: 'Pebble Chat (Small)',
    description:
      'Unfiltered Pebble Chat Small edition derived from Qwen2.5-3B using GPTQ 4-bit quantization for creative writing and unrestricted local workflows.',
    parametersBillion: 3.2,
    quantization: 'GPTQ',
    diskSizeGb: 2.15,
    supportedTasks: ['general_chat', 'coding'],
    assignedProfiles: [],
    isPebbleModel: true,
    tier: 'small',
    censorship: 'uncensored',
    noDownloadRequired: true,
    installed: true,
    priority: 'normal',
  },
  {
    id: 'pebble-chat-normal',
    name: 'Pebble AI Chat Normal',
    repoId: 'pebble-ai/Pebble-Chat-Normal-7B-Q4_K_M',
    baseModelRepo: 'Qwen/Qwen2.5-7B-Instruct',
    family: 'Pebble Chat (Normal)',
    description:
      'Flagship everyday Pebble Chat model edited from Qwen2.5-7B-Instruct. Uses Vulkan Compute GPU layers + 40GB DDR5 RAM offload for deep accuracy.',
    parametersBillion: 7.6,
    quantization: 'Q4_K_M',
    diskSizeGb: 4.68,
    supportedTasks: ['general_chat', 'coding', 'reasoning', 'omni_routing'],
    assignedProfiles: ['general_chat'],
    isPebbleModel: true,
    tier: 'normal',
    censorship: 'censored',
    noDownloadRequired: true,
    installed: true,
    priority: 'high',
  },
  {
    id: 'pebble-chat-normal-uncensored',
    name: 'Pebble AI Chat Normal (Uncensored)',
    repoId: 'pebble-ai/Pebble-Chat-Normal-8B-Uncensored-BNB_NF4',
    baseModelRepo: 'mlabonne/Meta-Llama-3.1-8B-Instruct-abliterated',
    family: 'Pebble Chat (Normal)',
    description:
      'Uncensored 8B general reasoning model edited from Llama-3.1-8B-Abliterated with bitsandbytes NF4 dynamic quantization.',
    parametersBillion: 8.0,
    quantization: 'BNB_NF4',
    diskSizeGb: 4.95,
    supportedTasks: ['general_chat', 'reasoning', 'coding'],
    assignedProfiles: [],
    isPebbleModel: true,
    tier: 'normal',
    censorship: 'uncensored',
    noDownloadRequired: true,
    installed: true,
    priority: 'normal',
  },
  {
    id: 'pebble-chat-ultra',
    name: 'Pebble AI Chat Ultra',
    repoId: 'pebble-ai/Pebble-Chat-Ultra-14B-Q4_K_M',
    baseModelRepo: 'Qwen/Qwen2.5-14B-Instruct',
    family: 'Pebble Chat (Ultra)',
    description:
      'High-capacity 14B synthesis & architecture model edited from Qwen2.5-14B-Instruct. Splits hot layers to 4GB VRAM and spills remaining layers to 40GB system RAM.',
    parametersBillion: 14.7,
    quantization: 'Q4_K_M',
    diskSizeGb: 8.95,
    supportedTasks: ['reasoning', 'coding', 'general_chat'],
    assignedProfiles: [],
    isPebbleModel: true,
    tier: 'ultra',
    censorship: 'censored',
    noDownloadRequired: true,
    installed: true,
    priority: 'normal',
  },
  {
    id: 'pebble-chat-ultra-uncensored',
    name: 'Pebble AI Chat Ultra (Uncensored)',
    repoId: 'pebble-ai/Pebble-Chat-Ultra-14B-Uncensored-GPTQ',
    baseModelRepo: 'Qwen/Qwen2.5-14B-Instruct',
    family: 'Pebble Chat (Ultra)',
    description:
      'Unfiltered 14B heavy reasoning model edited from Qwen2.5-14B with GPTQ 4-bit layer splitting across Vulkan VRAM + 40GB DDR5 RAM.',
    parametersBillion: 14.7,
    quantization: 'GPTQ',
    diskSizeGb: 8.8,
    supportedTasks: ['reasoning', 'coding', 'general_chat'],
    assignedProfiles: [],
    isPebbleModel: true,
    tier: 'ultra',
    censorship: 'uncensored',
    noDownloadRequired: true,
    installed: true,
    priority: 'low',
  },

  // =========================================================================
  // PEBBLE AI IMAGE SUITE — Edited Open-Source Models (Standard & Uncensored)
  // Built-in / Instant Ready (noDownloadRequired: true)
  // =========================================================================
  {
    id: 'pebble-image-tiny',
    name: 'Pebble AI Image Tiny',
    repoId: 'pebble-ai/Pebble-Image-Tiny-1B-BNB_NF4',
    baseModelRepo: 'IDKiro/sdxs-512-0.9',
    family: 'Pebble Image (Tiny)',
    description:
      'Sub-10s single-step & few-step draft image model edited from SDXS-512 with NF4 quantization. Runs easily inside 4GB VRAM.',
    parametersBillion: 0.9,
    quantization: 'BNB_NF4',
    diskSizeGb: 1.4,
    supportedTasks: ['image_generation', 'image_editing'],
    assignedProfiles: [],
    isPebbleModel: true,
    tier: 'tiny',
    censorship: 'censored',
    noDownloadRequired: true,
    installed: true,
    priority: 'normal',
  },
  {
    id: 'pebble-image-tiny-uncensored',
    name: 'Pebble AI Image Tiny (Uncensored)',
    repoId: 'pebble-ai/Pebble-Image-Tiny-1B-Uncensored',
    baseModelRepo: 'IDKiro/sdxs-512-0.9',
    family: 'Pebble Image (Tiny)',
    description:
      'Unfiltered fast draft image generator edited from SDXS-512 without safety-checker blocking for rapid artistic concepting.',
    parametersBillion: 0.9,
    quantization: 'BNB_NF4',
    diskSizeGb: 1.4,
    supportedTasks: ['image_generation', 'image_editing'],
    assignedProfiles: [],
    isPebbleModel: true,
    tier: 'tiny',
    censorship: 'uncensored',
    noDownloadRequired: true,
    installed: true,
    priority: 'low',
  },
  {
    id: 'pebble-image-small',
    name: 'Pebble AI Image Small',
    repoId: 'pebble-ai/Pebble-Image-Small-2.6B-INT8',
    baseModelRepo: 'stabilityai/sdxl-turbo',
    family: 'Pebble Image (Small)',
    description:
      'Balanced 2.6B photoreal & edit model edited from SDXL-Turbo with DirectML + INT8 offloading and tiled VAE for 768px outputs.',
    parametersBillion: 2.6,
    quantization: 'INT8_OFFLOAD',
    diskSizeGb: 3.1,
    supportedTasks: ['image_generation', 'image_editing'],
    assignedProfiles: [],
    isPebbleModel: true,
    tier: 'small',
    censorship: 'censored',
    noDownloadRequired: true,
    installed: true,
    priority: 'high',
  },
  {
    id: 'pebble-image-small-uncensored',
    name: 'Pebble AI Image Small (Uncensored)',
    repoId: 'pebble-ai/Pebble-Image-Small-2.6B-Uncensored-INT8',
    baseModelRepo: 'stabilityai/sdxl-turbo',
    family: 'Pebble Image (Small)',
    description:
      'Uncensored 2.6B creative diffusion variant tuned for unrestricted local editing, style transfer, and mask inpainting.',
    parametersBillion: 2.6,
    quantization: 'INT8_OFFLOAD',
    diskSizeGb: 3.1,
    supportedTasks: ['image_generation', 'image_editing'],
    assignedProfiles: [],
    isPebbleModel: true,
    tier: 'small',
    censorship: 'uncensored',
    noDownloadRequired: true,
    installed: true,
    priority: 'normal',
  },
  {
    id: 'pebble-image-normal',
    name: 'Pebble AI Image Normal',
    repoId: 'pebble-ai/Pebble-Image-Normal-7B-INT8',
    baseModelRepo: 'Qwen/Qwen-Image-2.1',
    family: 'Pebble Image (Normal)',
    description:
      'Tuned Pebble edition of Qwen Image 2.1 with sequential CPU offload, NF4 text encoder compression, and mask-aware inpainting + background removal.',
    parametersBillion: 7.0,
    quantization: 'INT8_OFFLOAD',
    diskSizeGb: 7.9,
    supportedTasks: ['image_generation', 'image_editing'],
    assignedProfiles: ['image_generation', 'image_editing'],
    isPebbleModel: true,
    tier: 'normal',
    censorship: 'censored',
    noDownloadRequired: true,
    installed: true,
    priority: 'high',
  },
  {
    id: 'pebble-image-normal-uncensored',
    name: 'Pebble AI Image Normal (Uncensored)',
    repoId: 'pebble-ai/Pebble-Image-Normal-7B-Uncensored-NF4',
    baseModelRepo: 'Qwen/Qwen-Image-2.1',
    family: 'Pebble Image (Normal)',
    description:
      'Unfiltered Pebble Image Normal edited from Qwen Image 2.1 with bitsandbytes NF4 weight streaming and zero classifier blocks.',
    parametersBillion: 7.0,
    quantization: 'BNB_NF4',
    diskSizeGb: 6.8,
    supportedTasks: ['image_generation', 'image_editing'],
    assignedProfiles: [],
    isPebbleModel: true,
    tier: 'normal',
    censorship: 'uncensored',
    noDownloadRequired: true,
    installed: true,
    priority: 'normal',
  },
  {
    id: 'pebble-image-ultra',
    name: 'Pebble AI Image Ultra',
    repoId: 'pebble-ai/Pebble-Image-Ultra-12B-NF4',
    baseModelRepo: 'black-forest-labs/FLUX.1-dev',
    family: 'Pebble Image (Ultra)',
    description:
      'Maximum-fidelity 12B studio diffuser edited from FLUX.1-dev using bitsandbytes NF4 + 40GB RAM layer paging and 1024px tiled VAE.',
    parametersBillion: 12.0,
    quantization: 'BNB_NF4',
    diskSizeGb: 9.8,
    supportedTasks: ['image_generation', 'image_editing'],
    assignedProfiles: [],
    isPebbleModel: true,
    tier: 'ultra',
    censorship: 'censored',
    noDownloadRequired: true,
    installed: true,
    priority: 'normal',
  },
  {
    id: 'pebble-image-ultra-uncensored',
    name: 'Pebble AI Image Ultra (Uncensored)',
    repoId: 'pebble-ai/Pebble-Image-Ultra-12B-Uncensored-NF4',
    baseModelRepo: 'black-forest-labs/FLUX.1-dev',
    family: 'Pebble Image (Ultra)',
    description:
      'Unfiltered 12B FLUX-derived Pebble Ultra image studio engine with DirectML + sequential DDR5 offload and full paintbrush mask editing.',
    parametersBillion: 12.0,
    quantization: 'BNB_NF4',
    diskSizeGb: 9.8,
    supportedTasks: ['image_generation', 'image_editing'],
    assignedProfiles: [],
    isPebbleModel: true,
    tier: 'ultra',
    censorship: 'uncensored',
    noDownloadRequired: true,
    installed: true,
    priority: 'low',
  },

  // =========================================================================
  // CORE OPEN-SOURCE BASELINES & SPECIALISTS (Qwen Image 2.1, Coder, R1, Voice)
  // =========================================================================
  {
    id: 'qwen-image-2.1',
    name: 'Qwen Image 2.1 (Base)',
    repoId: 'Qwen/Qwen-Image-2.1',
    family: 'Qwen Image',
    description:
      'Primary reference 7B image generation and editing architecture supporting text-to-image, localized mask editing, RGBA extraction, and crisp typography.',
    parametersBillion: 7.0,
    quantization: 'INT8_OFFLOAD',
    diskSizeGb: 14.8,
    supportedTasks: ['image_generation', 'image_editing'],
    assignedProfiles: [],
    isPrimaryImageModel: true,
    noDownloadRequired: true,
    installed: true,
    priority: 'high',
  },
  {
    id: 'qwen2.5-coder-7b',
    name: 'Qwen 2.5 Coder 7B (AWQ)',
    repoId: 'Qwen/Qwen2.5-Coder-7B-Instruct-AWQ',
    family: 'Qwen Coder',
    description:
      'Dedicated programming, debugging, and code refactoring model with AWQ 4-bit Vulkan/DirectML layer execution.',
    parametersBillion: 7.6,
    quantization: 'AWQ',
    diskSizeGb: 4.45,
    supportedTasks: ['coding', 'reasoning'],
    assignedProfiles: ['coding'],
    noDownloadRequired: true,
    installed: true,
    priority: 'normal',
  },
  {
    id: 'deepseek-r1-distill-8b',
    name: 'DeepSeek R1 Distill Llama 8B (Q4_K_M)',
    repoId: 'deepseek-ai/DeepSeek-R1-Distill-Llama-8B',
    family: 'DeepSeek R1',
    description:
      'Step-by-step analytical reasoning and math verification model running reliably with Vulkan GPU layer split + DDR5 offload.',
    parametersBillion: 8.0,
    quantization: 'Q4_K_M',
    diskSizeGb: 4.92,
    supportedTasks: ['reasoning', 'coding', 'general_chat'],
    assignedProfiles: ['reasoning'],
    noDownloadRequired: true,
    installed: true,
    priority: 'normal',
  },
  {
    id: 'qwen2.5-vl-3b',
    name: 'Qwen 2.5 VL 3B (AWQ)',
    repoId: 'Qwen/Qwen2.5-VL-3B-Instruct-AWQ',
    family: 'Qwen VL',
    description:
      'Compact multimodal vision-language model for screenshot inspection, document OCR, and visual Q&A inside 4GB VRAM.',
    parametersBillion: 3.7,
    quantization: 'AWQ',
    diskSizeGb: 2.3,
    supportedTasks: ['vision', 'general_chat'],
    assignedProfiles: ['vision'],
    noDownloadRequired: true,
    installed: true,
    priority: 'normal',
  },
  {
    id: 'whisper-small-en',
    name: 'Whisper Small (INT8 CPU)',
    repoId: 'Systran/faster-whisper-small',
    family: 'Whisper',
    description:
      'Low-latency local automatic speech recognition running in system RAM so GPU VRAM stays free for visual and LLM workloads.',
    parametersBillion: 0.24,
    quantization: 'INT8_OFFLOAD',
    diskSizeGb: 0.48,
    supportedTasks: ['speech_recognition'],
    assignedProfiles: ['speech_recognition'],
    noDownloadRequired: true,
    installed: true,
    priority: 'critical',
  },
  {
    id: 'kokoro-82m-tts',
    name: 'Kokoro 82M / Piper Local TTS',
    repoId: 'hexgrad/Kokoro-82M',
    family: 'Kokoro TTS',
    description:
      'Natural lightweight local neural speech synthesizer running entirely on Ryzen CPU threads at real-time speed.',
    parametersBillion: 0.08,
    quantization: 'FP16',
    diskSizeGb: 0.32,
    supportedTasks: ['speech_generation'],
    assignedProfiles: ['speech_generation'],
    noDownloadRequired: true,
    installed: true,
    priority: 'critical',
  },
];

export function buildInitialModels(hardware: HardwareSpecs): ModelEntry[] {
  const evalRam = hardware.totalRamGb;
  const evalVram = hardware.isGpuAccelerated ? hardware.gpuVramGb : 0;
  const evalDisk = hardware.diskFreeGb;

  const evaluated: ModelEntry[] = DEFAULT_MODEL_CATALOG.map((seed) => {
    const compatibility = evaluateModelCompatibility({
      repoId: seed.repoId,
      parametersBillion: seed.parametersBillion,
      quantization: seed.quantization,
      diskSizeGb: seed.diskSizeGb,
      supportedTasks: seed.supportedTasks,
      hostRamGb: evalRam,
      hostVramGb: evalVram,
      hostFreeDiskGb: evalDisk,
      isGpuAccelerated: hardware.isGpuAccelerated,
      gpuVendor: hardware.gpuVendor,
      rocmAvailable: hardware.amdAcceleration?.rocmAvailable,
      vulkanAvailable: hardware.amdAcceleration?.vulkanAvailable,
      directmlAvailable: hardware.amdAcceleration?.directmlAvailable,
    });

    return {
      ...seed,
      downloadState: seed.installed ? 'completed' : 'idle',
      downloadProgress: seed.installed ? 100 : 0,
      status: 'unloaded',
      vramAllocatedGb: 0,
      ramAllocatedGb: 0,
      gpuLayersLoaded: 0,
      loadCount: 0,
      compatibility,
    };
  });

  return applySystemBestMatchRecommendations(evaluated, hardware);
}
