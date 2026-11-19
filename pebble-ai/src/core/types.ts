export type NavSection =
  | 'home'
  | 'chat'
  | 'image'
  | 'voice'
  | 'agent'
  | 'models'
  | 'routers'
  | 'remote'
  | 'settings';

export type RouterId = 'omni' | 'amd_hardware' | 'uncensored' | 'edge_voice';

export type OmniMode = 'automatic' | 'balanced' | 'manual';

export type PebbleModelTier = 'tiny' | 'small' | 'normal' | 'ultra';

export type CensorshipMode = 'censored' | 'uncensored';

export type QuantizationFormat =
  | 'Q4_K_M'
  | 'Q5_K_M'
  | 'Q6_K'
  | 'Q8_0'
  | 'AWQ'
  | 'GPTQ'
  | 'BNB_NF4'
  | 'INT8_OFFLOAD'
  | 'FP16'
  | 'BF16';

export type ModelTaskProfile =
  | 'general_chat'
  | 'coding'
  | 'reasoning'
  | 'vision'
  | 'image_generation'
  | 'image_editing'
  | 'speech_recognition'
  | 'speech_generation'
  | 'omni_routing';

export type CompatibilityTier =
  | 'Recommended'
  | 'Compatible with limitations'
  | 'Experimental'
  | 'Unsupported';

export type ExecutionBackend =
  | 'Vulkan Compute (AMD RDNA 2)'
  | 'DirectML + CPU Offload'
  | 'ROCm / HIP (Experimental)'
  | 'CPU (AVX2 / System RAM)'
  | 'Cloud Gateway (@google/genai)'
  | 'Local Worker HTTP';

export type ModelRuntimeStatus =
  | 'unloaded'
  | 'queued'
  | 'loading'
  | 'loaded_vram'
  | 'loaded_ram_offload'
  | 'loaded_cpu'
  | 'cloud_ready'
  | 'error';

export type ModelPriority = 'critical' | 'high' | 'normal' | 'low';

export interface AmdAccelerationStatus {
  vulkanAvailable: boolean;
  directmlAvailable: boolean;
  rocmAvailable: boolean;
  preferredBackend: ExecutionBackend;
  notes: string[];
}

export interface HardwareSpecs {
  detectedAt: string;
  hostname: string;
  platform: string;
  arch: string;
  osRelease: string;
  cpuModel: string;
  cpuCores: number;
  cpuThreads: number;
  totalRamGb: number;
  freeRamGb: number;
  usedRamGb: number;
  ramUsagePercent: number;
  cpuLoadPercent: number;
  diskTotalGb: number;
  diskFreeGb: number;
  gpuName: string;
  gpuVendor: string;
  gpuVramGb: number;
  gpuVramUsedGb: number;
  gpuDriverBackend: string;
  isGpuAccelerated: boolean;
  amdAcceleration: AmdAccelerationStatus;
  networkInterfaces: NetworkEndpoint[];
  activeWorkers: {
    ollama: boolean;
    qwenImage: boolean;
    voice: boolean;
    cloudGateway: boolean;
  };
  targetProfile: {
    deviceName: string;
    cpu: string;
    gpu: string;
    vramGb: number;
    ramGb: number;
    storage: string;
    os: string;
  };
}

export interface NetworkEndpoint {
  name: string;
  address: string;
  port: number;
  url: string;
  remoteClientUrl: string;
}

export interface CompatibilityReport {
  tier: CompatibilityTier;
  estimatedDiskGb: number;
  estimatedRamGb: number;
  estimatedVramGb: number;
  recommendedBackend: ExecutionBackend;
  supportsCpuFallback: boolean;
  requiresCpuOffload: boolean;
  gpuLayersOffloaded: number;
  totalLayers: number;
  systemFitScore: number;
  isSystemBestMatch?: boolean;
  bestMatchLabel?: string;
  reasons: string[];
  qwenLowVramProfile?: {
    sequentialCpuOffload: boolean;
    vaeTiling: boolean;
    attentionSlicing: boolean;
    precision: 'fp16' | 'bf16' | 'int8-offload' | 'bnb-nf4';
    maxRecommendedResolution: string;
    maxBatchSize: number;
  };
}

export interface ModelEntry {
  id: string;
  name: string;
  repoId: string;
  baseModelRepo?: string;
  family: string;
  description: string;
  parametersBillion: number;
  quantization: string;
  diskSizeGb: number;
  supportedTasks: ModelTaskProfile[];
  assignedProfiles: ModelTaskProfile[];
  isPrimaryImageModel?: boolean;
  isPebbleModel?: boolean;
  tier?: PebbleModelTier;
  censorship?: CensorshipMode;
  noDownloadRequired?: boolean;
  installed: boolean;
  downloadState: 'idle' | 'downloading' | 'paused' | 'completed' | 'error';
  downloadProgress: number;
  localPath?: string;
  workerEndpoint?: string;
  priority: ModelPriority;
  status: ModelRuntimeStatus;
  vramAllocatedGb: number;
  ramAllocatedGb: number;
  gpuLayersLoaded?: number;
  lastUsedAt?: number;
  loadCount: number;
  lastError?: string;
  compatibility: CompatibilityReport;
}

export interface QueuedModelTask {
  id: string;
  modelId: string;
  modelName: string;
  taskType: ModelTaskProfile;
  source: 'local' | 'remote';
  deviceName: string;
  enqueuedAt: number;
  status: 'waiting' | 'running' | 'completed' | 'failed';
}

export interface MemoryHistoryPoint {
  timestamp: number;
  ramUsedGb: number;
  vramUsedGb: number;
  loadedModelCount: number;
  activeModelName: string | null;
}

export interface OmniRoutingDecision {
  id: string;
  timestamp: number;
  userPromptSnippet: string;
  routerId?: RouterId;
  detectedTask: ModelTaskProfile;
  mode: OmniMode;
  selectedModelId: string;
  selectedModelName: string;
  backendUsed: ExecutionBackend;
  unloadedModels: string[];
  reasoning: string;
  latencyMs: number;
  status: 'completed' | 'recovered' | 'failed';
  source: 'desktop' | 'remote';
}

export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  textContent?: string;
  dataUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  modelId?: string;
  modelName?: string;
  backendUsed?: string;
  routingTask?: ModelTaskProfile;
  attachments?: ChatAttachment[];
  generatedImageUrl?: string;
  stopped?: boolean;
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  systemInstruction: string;
  selectedModelId: string;
  useOmniRouting: boolean;
  temperature: number;
  maxTokens: number;
  messages: ChatMessage[];
}

export interface GeneratedImageRecord {
  id: string;
  prompt: string;
  negativePrompt: string;
  modelId: string;
  modelName: string;
  backendUsed: string;
  mode: 'generate' | 'edit' | 'variation' | 'extract_rgba' | 'remove_background' | 'remove_object';
  aspectRatio: '1:1' | '4:3' | '3:4' | '16:9' | '9:16';
  width: number;
  height: number;
  steps: number;
  seed: number;
  lowVramProfile: boolean;
  imageUrl: string;
  sourceImageUrl?: string;
  editInstruction?: string;
  favorite: boolean;
  createdAt: number;
  source: 'desktop' | 'remote';
}

export type ThemePresetId =
  | 'misty_evergreen'
  | 'morning_cloud'
  | 'charcoal_studio'
  | 'nordic_dusk'
  | 'oceanic_depth'
  | 'amber_solitude'
  | 'solar_dawn'
  | 'mono_matte';

export type BackgroundAnimationStyle =
  | 'none'
  | 'aurora'
  | 'particles'
  | 'mesh_drift'
  | 'starfield';

export interface CustomUiThemeTokens {
  isDark: boolean;
  backdropGradient: string;
  panelBg: string;
  panelHoverBg: string;
  panelBorder: string;
  textPrimary: string;
  textSecondary: string;
  accentColor: string;
  accentHover: string;
  accentText: string;
  blurPx: number;
  recommendedAnimation: BackgroundAnimationStyle;
}

export interface VoiceTranscriptEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  language: string;
  timestamp: number;
  modelName?: string;
  modelCensorship?: CensorshipMode;
  audioDurationSec?: number;
  generatedImageUrl?: string;
  generatedImagePrompt?: string;
  actionLabel?: string;
  pcActionResult?: string;
}

export interface AgentStep {
  id: string;
  index: number;
  title: string;
  tool:
    | 'list_files'
    | 'read_file'
    | 'write_file'
    | 'create_directory'
    | 'search_files'
    | 'generate_image'
    | 'analyze_code'
    | 'reason_summary'
    | 'mouse_move'
    | 'mouse_click'
    | 'mouse_scroll'
    | 'keyboard_type'
    | 'keyboard_hotkey';
  args: Record<string, string>;
  requiresApproval: boolean;
  approvalStatus: 'pending' | 'approved' | 'rejected' | 'auto';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  preview?: string;
  output?: string;
}

export interface AgentTask {
  id: string;
  goal: string;
  status: 'planning' | 'awaiting_approval' | 'running' | 'completed' | 'cancelled' | 'failed';
  createdAt: number;
  updatedAt: number;
  workingDirectory: string;
  selectedModelId?: string;
  selectedModelName: string;
  modelCensorship?: CensorshipMode;
  steps: AgentStep[];
  logs: { timestamp: number; level: 'info' | 'warn' | 'error'; message: string }[];
  summary?: string;
}

export interface RemoteDevice {
  id: string;
  name: string;
  userAgent: string;
  ipAddress: string;
  pairedAt: number;
  lastSeenAt: number;
  revoked: boolean;
  allowFileUploads: boolean;
  allowVoice: boolean;
  allowImageGen: boolean;
}

export interface PebbleSettings {
  setupCompleted: boolean;
  developerMode: boolean;
  theme: 'dark' | 'light';
  themePreset: ThemePresetId;
  backgroundAnimation: BackgroundAnimationStyle;
  customBackgroundUrl?: string;
  aiCustomTheme?: CustomUiThemeTokens | null;
  activeRouterId: RouterId;
  omniMode: OmniMode;
  allowUncensoredModels: boolean;
  preferredQuantization: 'auto' | 'Q4_K_M' | 'AWQ' | 'GPTQ' | 'BNB_NF4';
  smartResourceMode: boolean;
  idleUnloadSeconds: number;
  maxVramBudgetGb: number;
  maxRamBudgetGb: number;
  qwenLowVramEnabled: boolean;
  remoteEnabled: boolean;
  remotePort: number;
  remotePin: string;
  remoteLocalNetworkOnly: boolean;
  localWorkers: {
    ollamaUrl: string;
    qwenImageUrl: string;
    voiceWorkerUrl: string;
    pcControlWorkerUrl?: string;
    preferLocalWorkers: boolean;
  };
  voice: {
    selectedVoice: 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';
    speakingSpeed: number;
    language: string;
    vadEnabled: boolean;
    pushToTalk: boolean;
    continuousHandsFree: boolean;
  };
  modelStorageDir: string;
}

export interface PebbleStateSnapshot {
  settings: PebbleSettings;
  hardware: HardwareSpecs;
  models: ModelEntry[];
  queue: QueuedModelTask[];
  memoryHistory: MemoryHistoryPoint[];
  routingHistory: OmniRoutingDecision[];
  conversations: Conversation[];
  images: GeneratedImageRecord[];
  voiceHistory: VoiceTranscriptEntry[];
  agentTasks: AgentTask[];
  remoteDevices: RemoteDevice[];
}
