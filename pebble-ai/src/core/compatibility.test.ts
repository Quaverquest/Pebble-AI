import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateModelCompatibility } from './compatibility';
import { buildInitialModels } from './catalog';
import type { HardwareSpecs } from './types';

const victusHardware: HardwareSpecs = {
  detectedAt: new Date().toISOString(),
  hostname: 'victus-15',
  platform: 'win32',
  arch: 'x64',
  osRelease: '10.0.22631',
  cpuModel: 'AMD Ryzen 5 7535HS',
  cpuCores: 6,
  cpuThreads: 12,
  totalRamGb: 40,
  freeRamGb: 32,
  usedRamGb: 8,
  ramUsagePercent: 20,
  cpuLoadPercent: 10,
  diskTotalGb: 950,
  diskFreeGb: 520,
  gpuName: 'AMD Radeon RX 6500M',
  gpuVendor: 'AMD',
  gpuVramGb: 4,
  gpuVramUsedGb: 0,
  gpuDriverBackend: 'Vulkan Compute + DirectML (AMD RDNA 2)',
  isGpuAccelerated: true,
  amdAcceleration: {
    vulkanAvailable: true,
    directmlAvailable: true,
    rocmAvailable: false,
    preferredBackend: 'Vulkan Compute (AMD RDNA 2)',
    notes: [],
  },
  networkInterfaces: [],
  activeWorkers: {
    ollama: false,
    qwenImage: false,
    voice: false,
    cloudGateway: true,
  },
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

test('Qwen Image 2.1 on RX 6500M 4GB VRAM + 40GB RAM enables low-VRAM sequential offload profile', () => {
  const report = evaluateModelCompatibility({
    repoId: 'Qwen/Qwen-Image-2.1',
    parametersBillion: 7.0,
    quantization: 'INT8_OFFLOAD',
    diskSizeGb: 14.8,
    supportedTasks: ['image_generation', 'image_editing'],
    hostRamGb: 40,
    hostVramGb: 4,
    hostFreeDiskGb: 450,
    isGpuAccelerated: true,
    gpuVendor: 'AMD Radeon RX 6500M',
  });

  assert.equal(report.tier, 'Compatible with limitations');
  assert.equal(report.requiresCpuOffload, true);
  assert.ok(report.estimatedVramGb <= 3.5);
  assert.ok(report.gpuLayersOffloaded > 0 && report.gpuLayersOffloaded < report.totalLayers);
  assert.ok(report.qwenLowVramProfile);
  assert.equal(report.qwenLowVramProfile?.sequentialCpuOffload, true);
  assert.equal(report.qwenLowVramProfile?.vaeTiling, true);
  assert.equal(report.qwenLowVramProfile?.maxBatchSize, 1);
});

test('AWQ 3B model fits fully in RX 6500M 4GB VRAM with Vulkan Compute', () => {
  const report = evaluateModelCompatibility({
    repoId: 'pebble-ai/Pebble-Chat-Small-3B-AWQ',
    parametersBillion: 3.2,
    quantization: 'AWQ',
    diskSizeGb: 2.1,
    supportedTasks: ['general_chat'],
    hostRamGb: 40,
    hostVramGb: 4,
    hostFreeDiskGb: 450,
    isGpuAccelerated: true,
    gpuVendor: 'AMD',
  });

  assert.equal(report.tier, 'Recommended');
  assert.equal(report.requiresCpuOffload, false);
  assert.equal(report.gpuLayersOffloaded, report.totalLayers);
  assert.equal(report.recommendedBackend, 'Vulkan Compute (AMD RDNA 2)');
  assert.ok(report.systemFitScore >= 85);
});

test('Lightweight voice model stays in system RAM with 0 VRAM usage', () => {
  const report = evaluateModelCompatibility({
    repoId: 'Systran/faster-whisper-small',
    parametersBillion: 0.24,
    quantization: 'INT8',
    diskSizeGb: 0.48,
    supportedTasks: ['speech_recognition'],
    hostRamGb: 40,
    hostVramGb: 4,
    hostFreeDiskGb: 450,
    isGpuAccelerated: true,
    gpuVendor: 'AMD',
  });

  assert.equal(report.tier, 'Recommended');
  assert.equal(report.estimatedVramGb, 0);
  assert.equal(report.recommendedBackend, 'CPU (AVX2 / System RAM)');
});

test('Model exceeding disk or RAM budget is marked Unsupported', () => {
  const report = evaluateModelCompatibility({
    repoId: 'meta-llama/Llama-3.1-405B-FP16',
    parametersBillion: 405,
    quantization: 'FP16',
    diskSizeGb: 810,
    supportedTasks: ['general_chat'],
    hostRamGb: 40,
    hostVramGb: 4,
    hostFreeDiskGb: 200,
    isGpuAccelerated: true,
    gpuVendor: 'AMD',
  });

  assert.equal(report.tier, 'Unsupported');
});

test('Catalog contains Censored & Uncensored variants across Tiny/Small/Normal/Ultra with zero downloads needed and auto-detects System Best Match', () => {
  const models = buildInitialModels(victusHardware);
  const pebbleChat = models.filter((m) => m.isPebbleModel && m.supportedTasks.includes('general_chat'));
  const pebbleImage = models.filter((m) => m.isPebbleModel && m.supportedTasks.includes('image_generation'));

  assert.equal(pebbleChat.length, 8);
  assert.equal(pebbleImage.length, 8);
  assert.ok(models.filter((m) => m.isPebbleModel).every((m) => m.installed && m.noDownloadRequired));

  const bestMatches = models.filter((m) => m.compatibility.isSystemBestMatch);
  assert.equal(bestMatches.length, 2);
});
