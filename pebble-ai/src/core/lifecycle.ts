import { evaluateModelCompatibility } from './compatibility';
import type {
  HardwareSpecs,
  ModelEntry,
  ModelPriority,
  ModelRuntimeStatus,
  PebbleSettings,
} from './types';

export interface LifecyclePlan {
  modelToLoad: ModelEntry;
  modelsToUnload: ModelEntry[];
  targetStatus: ModelRuntimeStatus;
  allocatedVramGb: number;
  allocatedRamGb: number;
  gpuLayersLoaded: number;
  reason: string;
}

const PRIORITY_WEIGHT: Record<ModelPriority, number> = {
  low: 1,
  normal: 2,
  high: 3,
  critical: 4,
};

export function isModelActiveInMemory(model: ModelEntry): boolean {
  return (
    model.status === 'loaded_vram' ||
    model.status === 'loaded_ram_offload' ||
    model.status === 'loaded_cpu'
  );
}

/**
 * Re-evaluates a model under a new quantization scheme (Q4_K_M, AWQ, GPTQ, BNB_NF4, INT8_OFFLOAD, FP16)
 * so the user or router can dynamically shrink or balance its VRAM/RAM footprint.
 */
export function requantizeModelEntry(
  model: ModelEntry,
  quantization: string,
  hardware: HardwareSpecs
): ModelEntry {
  const nextCompatibility = evaluateModelCompatibility({
    repoId: model.repoId,
    parametersBillion: model.parametersBillion,
    quantization,
    supportedTasks: model.supportedTasks,
    hostRamGb: hardware.totalRamGb,
    hostVramGb: hardware.isGpuAccelerated ? hardware.gpuVramGb : 0,
    hostFreeDiskGb: hardware.diskFreeGb,
    isGpuAccelerated: hardware.isGpuAccelerated,
    gpuVendor: hardware.gpuVendor,
    rocmAvailable: hardware.amdAcceleration?.rocmAvailable,
    vulkanAvailable: hardware.amdAcceleration?.vulkanAvailable,
    directmlAvailable: hardware.amdAcceleration?.directmlAvailable,
  });

  return {
    ...model,
    quantization,
    diskSizeGb: nextCompatibility.estimatedDiskGb,
    compatibility: {
      ...nextCompatibility,
      isSystemBestMatch: model.compatibility.isSystemBestMatch,
      bestMatchLabel: model.compatibility.bestMatchLabel,
    },
  };
}

/**
 * Plans how to load a requested model within VRAM and RAM budgets, computing GPU layer offloading
 * vs. system RAM spillover and enforcing 4GB VRAM concurrency protection.
 */
export function planModelLoad(
  models: ModelEntry[],
  targetModelId: string,
  settings: PebbleSettings,
  options?: { forceCpuFallback?: boolean }
): LifecyclePlan {
  const target = models.find((m) => m.id === targetModelId);
  if (!target) {
    throw new Error(`Model '${targetModelId}' not found in registry.`);
  }

  const activeModels = models.filter(
    (m) => m.id !== target.id && isModelActiveInMemory(m)
  );

  const isHeavyGpuTask =
    target.supportedTasks.includes('image_generation') ||
    target.supportedTasks.includes('image_editing') ||
    target.compatibility.estimatedVramGb >= 2.2;

  const needVram = options?.forceCpuFallback
    ? 0
    : Math.min(settings.maxVramBudgetGb, target.compatibility.estimatedVramGb);
  const spilledVram = Math.max(0, target.compatibility.estimatedVramGb - needVram);
  const needRam = options?.forceCpuFallback
    ? Number((target.compatibility.estimatedRamGb + target.compatibility.estimatedVramGb).toFixed(2))
    : Number((target.compatibility.estimatedRamGb + spilledVram).toFixed(2));

  const gpuLayersLoaded = options?.forceCpuFallback
    ? 0
    : target.compatibility.gpuLayersOffloaded;

  const modelsToUnload: ModelEntry[] = [];
  let projectedVram = activeModels.reduce((acc, m) => acc + m.vramAllocatedGb, 0);
  let projectedRam = activeModels.reduce((acc, m) => acc + m.ramAllocatedGb, 0);

  // Sort eviction candidates: lowest priority first, then oldest lastUsedAt
  const candidates = [...activeModels].sort((a, b) => {
    const pDiff = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
    if (pDiff !== 0) return pDiff;
    return (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0);
  });

  // Rule 1: On 4GB VRAM with Smart Resource Mode, keep at most one major GPU-intensive model in VRAM
  if (settings.smartResourceMode && isHeavyGpuTask && !options?.forceCpuFallback) {
    for (const candidate of candidates) {
      if (candidate.vramAllocatedGb >= 1.4 && !modelsToUnload.some((u) => u.id === candidate.id)) {
        modelsToUnload.push(candidate);
        projectedVram -= candidate.vramAllocatedGb;
        projectedRam -= candidate.ramAllocatedGb;
      }
    }
  }

  // Rule 2: Evict until VRAM and RAM budgets fit
  for (const candidate of candidates) {
    if (modelsToUnload.some((u) => u.id === candidate.id)) continue;
    const vramOverflow = projectedVram + needVram > settings.maxVramBudgetGb;
    const ramOverflow = projectedRam + needRam > settings.maxRamBudgetGb;
    if (vramOverflow || ramOverflow) {
      if (candidate.priority === 'critical' && !ramOverflow && candidate.vramAllocatedGb === 0) {
        continue;
      }
      modelsToUnload.push(candidate);
      projectedVram = Math.max(0, projectedVram - candidate.vramAllocatedGb);
      projectedRam = Math.max(0, projectedRam - candidate.ramAllocatedGb);
    }
  }

  let targetStatus: ModelRuntimeStatus = 'loaded_cpu';
  if (options?.forceCpuFallback || needVram === 0) {
    targetStatus = 'loaded_cpu';
  } else if (target.compatibility.requiresCpuOffload || spilledVram > 0) {
    targetStatus = 'loaded_ram_offload';
  } else {
    targetStatus = 'loaded_vram';
  }

  const reasonParts: string[] = [];
  if (options?.forceCpuFallback) {
    reasonParts.push('OOM/Backend fallback engaged: all layers offloaded to DDR5 system RAM.');
  } else if (modelsToUnload.length > 0) {
    reasonParts.push(
      `Smart Resource Mode released ${modelsToUnload.map((m) => m.name).join(', ')} (${gpuLayersLoaded}/${target.compatibility.totalLayers} GPU layers allocated inside ${settings.maxVramBudgetGb}GB budget).`
    );
  } else {
    reasonParts.push(
      `Loaded ${gpuLayersLoaded}/${target.compatibility.totalLayers} layers on GPU (${target.quantization}) cleanly within ${settings.maxVramBudgetGb}GB VRAM / ${settings.maxRamBudgetGb}GB RAM budgets.`
    );
  }

  return {
    modelToLoad: target,
    modelsToUnload,
    targetStatus,
    allocatedVramGb: Number(needVram.toFixed(2)),
    allocatedRamGb: Number(needRam.toFixed(2)),
    gpuLayersLoaded,
    reason: reasonParts.join(' '),
  };
}

export function findIdleModelsToUnload(
  models: ModelEntry[],
  nowMs: number,
  idleUnloadSeconds: number
): ModelEntry[] {
  if (idleUnloadSeconds <= 0) return [];
  const thresholdMs = idleUnloadSeconds * 1000;
  return models.filter((m) => {
    if (!isModelActiveInMemory(m)) return false;
    if (m.priority === 'critical') return false;
    const lastUsed = m.lastUsedAt ?? 0;
    return nowMs - lastUsed >= thresholdMs;
  });
}

export function applyLifecyclePlan(
  models: ModelEntry[],
  plan: LifecyclePlan,
  nowMs: number
): ModelEntry[] {
  const unloadIds = new Set(plan.modelsToUnload.map((m) => m.id));
  return models.map((m) => {
    if (unloadIds.has(m.id)) {
      return {
        ...m,
        status: 'unloaded',
        vramAllocatedGb: 0,
        ramAllocatedGb: 0,
        gpuLayersLoaded: 0,
      };
    }
    if (m.id === plan.modelToLoad.id) {
      return {
        ...m,
        status: plan.targetStatus,
        vramAllocatedGb: plan.allocatedVramGb,
        ramAllocatedGb: plan.allocatedRamGb,
        gpuLayersLoaded: plan.gpuLayersLoaded,
        lastUsedAt: nowMs,
        loadCount: m.loadCount + 1,
        lastError: undefined,
      };
    }
    return m;
  });
}
