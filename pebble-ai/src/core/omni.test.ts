import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyUserTask, resolveOmniRoute } from './omni';
import { buildInitialModels } from './catalog';
import type { HardwareSpecs } from './types';

const mockHardware: HardwareSpecs = {
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

test('Omni classifies image, coding, and TTS requests accurately', () => {
  assert.equal(classifyUserTask('Make a realistic picture of a futuristic city.'), 'image_generation');
  assert.equal(classifyUserTask('Explain this Python traceback error in my FastAPI route.'), 'coding');
  assert.equal(classifyUserTask('Can you read this document aloud?'), 'speech_generation');
  assert.equal(classifyUserTask('Remove the background from this portrait', { hasImageAttachment: true }), 'image_editing');
  assert.equal(classifyUserTask('What is written on this whiteboard?', { hasImageAttachment: true }), 'vision');
});

test('Omni routes image requests across Pebble AI Image models cleanly', () => {
  const models = buildInitialModels(mockHardware);
  const route = resolveOmniRoute({
    prompt: 'Make a realistic picture of a futuristic city.',
    routerId: 'omni',
    mode: 'automatic',
    models,
    preferLocalWorkers: false,
    activeWorkers: mockHardware.activeWorkers,
  });

  assert.equal(route.detectedTask, 'image_generation');
  assert.equal(route.routerId, 'omni');
  assert.equal(route.selectedModel.id, 'pebble-image-normal');
});

test('Uncensored Creative Router selects Uncensored Pebble AI Chat and Image variants', () => {
  const models = buildInitialModels(mockHardware);
  const chatRoute = resolveOmniRoute({
    prompt: 'Write an unfiltered sci-fi scene about a rogue android.',
    routerId: 'uncensored',
    mode: 'automatic',
    models,
    preferLocalWorkers: false,
    activeWorkers: mockHardware.activeWorkers,
  });
  const imageRoute = resolveOmniRoute({
    prompt: 'Generate a dramatic photograph of a stormy coastline.',
    routerId: 'uncensored',
    mode: 'automatic',
    models,
    preferLocalWorkers: false,
    activeWorkers: mockHardware.activeWorkers,
  });

  assert.equal(chatRoute.selectedModel.censorship, 'uncensored');
  assert.equal(imageRoute.selectedModel.censorship, 'uncensored');
});

test('Low-Latency Edge & Voice Router picks Pebble Tiny/Small over heavy Ultra models', () => {
  const models = buildInitialModels(mockHardware);
  const route = resolveOmniRoute({
    prompt: 'Summarize the weather check.',
    routerId: 'edge_voice',
    mode: 'balanced',
    models,
    preferLocalWorkers: false,
    activeWorkers: mockHardware.activeWorkers,
  });

  assert.ok(route.selectedModel.tier === 'tiny' || route.selectedModel.tier === 'small');
});

test('Omni manual mode honors user-selected model override', () => {
  const models = buildInitialModels(mockHardware);
  const route = resolveOmniRoute({
    prompt: 'Hello world',
    routerId: 'omni',
    mode: 'manual',
    manualModelId: 'pebble-chat-ultra-uncensored',
    models,
    preferLocalWorkers: false,
    activeWorkers: mockHardware.activeWorkers,
  });

  assert.equal(route.selectedModel.id, 'pebble-chat-ultra-uncensored');
});
