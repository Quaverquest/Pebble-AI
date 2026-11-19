import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLifecyclePlan,
  findIdleModelsToUnload,
  planModelLoad,
  requantizeModelEntry,
} from './lifecycle';
import type { HardwareSpecs, ModelEntry, PebbleSettings } from './types';

const baseSettings: PebbleSettings = {
  setupCompleted: true,
  developerMode: false,
  theme: 'dark',
  themePreset: 'misty_evergreen',
  backgroundAnimation: 'aurora',
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
  remotePort: 3000,
  remotePin: '482910',
  remoteLocalNetworkOnly: true,
  localWorkers: {
    ollamaUrl: 'http://127.0.0.1:11434',
    qwenImageUrl: 'http://127.0.0.1:7861',
    voiceWorkerUrl: 'http://127.0.0.1:7862',
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
  modelStorageDir: 'data/models',
};

const mockHw: HardwareSpecs = {
  detectedAt: new Date().toISOString(),
  hostname: 'victus-15',
  platform: 'win32',
  arch: 'x64',
  osRelease: '10.0.22631',
  cpuModel: 'AMD Ryzen 5 7535HS',
  cpuCores: 6,
  cpuThreads: 12,
  totalRamGb: 40,
  freeRamGb: 30,
  usedRamGb: 10,
  ramUsagePercent: 25,
  cpuLoadPercent: 12,
  diskTotalGb: 950,
  diskFreeGb: 520,
  gpuName: 'AMD Radeon RX 6500M',
  gpuVendor: 'AMD',
  gpuVramGb: 4,
  gpuVramUsedGb: 0.4,
  gpuDriverBackend: 'Vulkan Compute + DirectML',
  isGpuAccelerated: true,
  amdAcceleration: {
    vulkanAvailable: true,
    directmlAvailable: true,
    rocmAvailable: false,
    preferredBackend: 'Vulkan Compute (AMD RDNA 2)',
    notes: [],
  },
  networkInterfaces: [],
  activeWorkers: { ollama: false, qwenImage: false, voice: false, cloudGateway: true },
  targetProfile: {
    deviceName: 'HP Victus 15',
    cpu: 'AMD Ryzen 5 7535HS',
    gpu: 'AMD Radeon RX 6500M',
    vramGb: 4,
    ramGb: 40,
    storage: '1TB Samsung NVMe SSD',
    os: 'Windows 11',
  },
};

function makeModel(overrides: Partial<ModelEntry>): ModelEntry {
  return {
    id: 'm1',
    name: 'Model 1',
    repoId: 'org/m1',
    family: 'Test',
    description: 'test',
    parametersBillion: 7,
    quantization: 'Q4_K_M',
    diskSizeGb: 4.5,
    supportedTasks: ['general_chat'],
    assignedProfiles: ['general_chat'],
    installed: true,
    downloadState: 'completed',
    downloadProgress: 100,
    priority: 'normal',
    status: 'unloaded',
    vramAllocatedGb: 0,
    ramAllocatedGb: 0,
    gpuLayersLoaded: 0,
    loadCount: 0,
    compatibility: {
      tier: 'Recommended',
      estimatedDiskGb: 4.5,
      estimatedRamGb: 4.0,
      estimatedVramGb: 3.2,
      recommendedBackend: 'Vulkan Compute (AMD RDNA 2)',
      supportsCpuFallback: true,
      requiresCpuOffload: true,
      gpuLayersOffloaded: 20,
      totalLayers: 32,
      systemFitScore: 86,
      reasons: [],
    },
    ...overrides,
  };
}

test('Smart Resource Mode evicts heavy GPU chat model before loading Qwen Image 2.1 and tracks GPU layers', () => {
  const chatModel = makeModel({
    id: 'pebble-chat-normal',
    name: 'Pebble AI Chat Normal',
    status: 'loaded_ram_offload',
    vramAllocatedGb: 3.2,
    ramAllocatedGb: 4.0,
    gpuLayersLoaded: 20,
    lastUsedAt: 1000,
  });
  const imageModel = makeModel({
    id: 'pebble-image-normal',
    name: 'Pebble AI Image Normal',
    supportedTasks: ['image_generation', 'image_editing'],
    assignedProfiles: ['image_generation', 'image_editing'],
    compatibility: {
      tier: 'Compatible with limitations',
      estimatedDiskGb: 7.9,
      estimatedRamGb: 6.5,
      estimatedVramGb: 3.4,
      recommendedBackend: 'DirectML + CPU Offload',
      supportsCpuFallback: true,
      requiresCpuOffload: true,
      gpuLayersOffloaded: 22,
      totalLayers: 48,
      systemFitScore: 78,
      reasons: [],
    },
  });
  const whisper = makeModel({
    id: 'whisper',
    name: 'Whisper Small',
    supportedTasks: ['speech_recognition'],
    priority: 'critical',
    status: 'loaded_cpu',
    vramAllocatedGb: 0,
    ramAllocatedGb: 0.9,
    lastUsedAt: 900,
  });

  const plan = planModelLoad([chatModel, imageModel, whisper], 'pebble-image-normal', baseSettings);
  assert.equal(plan.modelsToUnload.length, 1);
  assert.equal(plan.modelsToUnload[0].id, 'pebble-chat-normal');
  assert.equal(plan.gpuLayersLoaded, 22);

  const updated = applyLifecyclePlan([chatModel, imageModel, whisper], plan, 5000);
  const updatedChat = updated.find((m) => m.id === 'pebble-chat-normal')!;
  const updatedImage = updated.find((m) => m.id === 'pebble-image-normal')!;
  const updatedWhisper = updated.find((m) => m.id === 'whisper')!;

  assert.equal(updatedChat.status, 'unloaded');
  assert.equal(updatedChat.gpuLayersLoaded, 0);
  assert.equal(updatedImage.status, 'loaded_ram_offload');
  assert.equal(updatedImage.gpuLayersLoaded, 22);
  assert.equal(updatedWhisper.status, 'loaded_cpu');
});

test('Requantizing a model from Q8_0 to AWQ reduces estimated RAM/disk footprint', () => {
  const m = makeModel({
    id: 'pebble-chat-ultra',
    parametersBillion: 14,
    quantization: 'Q8_0',
    diskSizeGb: 15.0,
  });
  const q8 = requantizeModelEntry(m, 'Q8_0', mockHw);
  const awq = requantizeModelEntry(m, 'AWQ', mockHw);
  assert.ok(awq.diskSizeGb < q8.diskSizeGb);
  assert.ok(awq.compatibility.gpuLayersOffloaded > q8.compatibility.gpuLayersOffloaded);
});

test('Idle reaper identifies non-critical expired models and preserves critical voice services', () => {
  const expired = makeModel({
    id: 'old-chat',
    status: 'loaded_vram',
    lastUsedAt: 1000,
    priority: 'normal',
  });
  const critical = makeModel({
    id: 'tts',
    status: 'loaded_cpu',
    lastUsedAt: 1000,
    priority: 'critical',
  });
  const recent = makeModel({
    id: 'fresh',
    status: 'loaded_vram',
    lastUsedAt: 350_000,
    priority: 'normal',
  });

  const toUnload = findIdleModelsToUnload([expired, critical, recent], 400_000, 300);
  assert.deepEqual(
    toUnload.map((m) => m.id),
    ['old-chat']
  );
});
