import type {
  CompatibilityReport,
  CompatibilityTier,
  ExecutionBackend,
  HardwareSpecs,
  ModelEntry,
  ModelTaskProfile,
} from './types';

export interface CompatibilityInput {
  repoId: string;
  parametersBillion: number;
  quantization: string;
  diskSizeGb?: number;
  supportedTasks: ModelTaskProfile[];
  hostRamGb: number;
  hostVramGb: number;
  hostFreeDiskGb: number;
  isGpuAccelerated: boolean;
  gpuVendor: string;
  rocmAvailable?: boolean;
  vulkanAvailable?: boolean;
  directmlAvailable?: boolean;
}

/**
 * Computes layer counts and quantization bytes/parameter for AWQ, GPTQ, bitsandbytes NF4,
 * GGUF (Q4_K_M / Q5_K_M / Q6_K / Q8_0), INT8 Offload, and FP16/BF16 weights.
 */
export function getQuantizationMetrics(quantization: string): {
  bytesPerParam: number;
  vramEfficiencyBonus: number;
  formatLabel: string;
} {
  const quant = quantization.toUpperCase();
  if (quant.includes('FP16') || quant.includes('BF16')) {
    return { bytesPerParam: 2.0, vramEfficiencyBonus: 0, formatLabel: 'FP16 / BF16' };
  }
  if (quant.includes('INT8') || quant.includes('Q8')) {
    return { bytesPerParam: 1.05, vramEfficiencyBonus: 8, formatLabel: 'INT8 / Q8_0' };
  }
  if (quant.includes('Q6')) {
    return { bytesPerParam: 0.8, vramEfficiencyBonus: 12, formatLabel: 'Q6_K' };
  }
  if (quant.includes('Q5')) {
    return { bytesPerParam: 0.68, vramEfficiencyBonus: 16, formatLabel: 'Q5_K_M' };
  }
  if (quant.includes('AWQ')) {
    return { bytesPerParam: 0.54, vramEfficiencyBonus: 24, formatLabel: 'AWQ 4-bit' };
  }
  if (quant.includes('GPTQ')) {
    return { bytesPerParam: 0.55, vramEfficiencyBonus: 22, formatLabel: 'GPTQ 4-bit' };
  }
  if (quant.includes('BNB') || quant.includes('NF4')) {
    return { bytesPerParam: 0.56, vramEfficiencyBonus: 21, formatLabel: 'bitsandbytes NF4' };
  }
  if (quant.includes('Q4') || quant.includes('INT4')) {
    return { bytesPerParam: 0.56, vramEfficiencyBonus: 22, formatLabel: 'GGUF Q4_K_M' };
  }
  if (quant.includes('Q3') || quant.includes('Q2')) {
    return { bytesPerParam: 0.42, vramEfficiencyBonus: 18, formatLabel: 'GGUF Ultra-Low' };
  }
  return { bytesPerParam: 0.56, vramEfficiencyBonus: 20, formatLabel: quantization };
}

export function estimateTotalLayers(parametersBillion: number, isImageDiffuser: boolean): number {
  if (isImageDiffuser) {
    if (parametersBillion <= 1.2) return 24;
    if (parametersBillion <= 4) return 32;
    if (parametersBillion <= 9) return 48;
    return 60;
  }
  if (parametersBillion <= 1) return 22;
  if (parametersBillion <= 2.5) return 28;
  if (parametersBillion <= 4.5) return 36;
  if (parametersBillion <= 9) return 32;
  if (parametersBillion <= 16) return 48;
  return 64;
}

/**
 * Estimates disk, system RAM, VRAM footprints, GPU layer split, and system fit score
 * specifically tuned for AMD Radeon RX 6500M (4GB VRAM, RDNA 2) + 40GB System RAM on Windows 11,
 * while remaining completely truthful on non-GPU hosts.
 */
export function evaluateModelCompatibility(input: CompatibilityInput): CompatibilityReport {
  const quantMetrics = getQuantizationMetrics(input.quantization);
  const quant = input.quantization.toUpperCase();

  const isImageDiffuser =
    input.supportedTasks.includes('image_generation') ||
    input.supportedTasks.includes('image_editing');
  const isVoice =
    input.supportedTasks.includes('speech_recognition') ||
    input.supportedTasks.includes('speech_generation');

  const totalLayers = isVoice ? 12 : estimateTotalLayers(input.parametersBillion, isImageDiffuser);

  const estimatedDiskGb =
    input.diskSizeGb && input.diskSizeGb > 0
      ? Number(input.diskSizeGb.toFixed(2))
      : Number(
          Math.max(
            0.25,
            input.parametersBillion * quantMetrics.bytesPerParam * (isImageDiffuser ? 1.22 : 1.05)
          ).toFixed(2)
        );

  // Runtime activation + KV cache overhead
  const isQwenImage = input.repoId.toLowerCase().includes('qwen-image') || isImageDiffuser;
  const runtimeOverheadGb = isImageDiffuser
    ? input.parametersBillion <= 2
      ? 1.15
      : input.parametersBillion <= 4
        ? 1.75
        : 2.35
    : isVoice
      ? 0.45
      : Math.min(4.5, 0.65 + input.parametersBillion * 0.14);

  const boundedImageResident =
    isImageDiffuser && quant.includes('INT8')
      ? Math.min(estimatedDiskGb, 6.2)
      : quant.includes('NF4') || quant.includes('AWQ') || quant.includes('GPTQ')
        ? Math.min(estimatedDiskGb, input.parametersBillion * 0.72)
        : estimatedDiskGb;

  const fullMemoryGb = isImageDiffuser
    ? Number((boundedImageResident + runtimeOverheadGb).toFixed(2))
    : Number((estimatedDiskGb + runtimeOverheadGb).toFixed(2));

  const reasons: string[] = [];
  const isAmd =
    input.gpuVendor.toLowerCase().includes('amd') ||
    input.gpuVendor.toLowerCase().includes('radeon');
  const vramBudget = Math.max(0, input.hostVramGb);
  const safeVramCap = Number(Math.min(vramBudget * 0.86, 3.45).toFixed(2));

  let estimatedVramGb = 0;
  let estimatedRamGb = fullMemoryGb;
  let requiresCpuOffload = false;
  let gpuLayersOffloaded = 0;
  let recommendedBackend: ExecutionBackend = 'CPU (AVX2 / System RAM)';

  if (isVoice) {
    estimatedVramGb = 0;
    estimatedRamGb = fullMemoryGb;
    gpuLayersOffloaded = 0;
    recommendedBackend = 'CPU (AVX2 / System RAM)';
    reasons.push('Voice weights stay in system RAM on Ryzen CPU so GPU VRAM remains dedicated to chat or visual tasks.');
  } else if (input.isGpuAccelerated && vramBudget > 0) {
    if (fullMemoryGb <= vramBudget * 0.88) {
      estimatedVramGb = fullMemoryGb;
      estimatedRamGb = Number(Math.max(0.5, runtimeOverheadGb * 0.55).toFixed(2));
      gpuLayersOffloaded = totalLayers;
      if (isAmd) {
        recommendedBackend = isImageDiffuser
          ? 'DirectML + CPU Offload'
          : input.rocmAvailable
            ? 'ROCm / HIP (Experimental)'
            : 'Vulkan Compute (AMD RDNA 2)';
      } else {
        recommendedBackend = 'DirectML + CPU Offload';
      }
      reasons.push(
        `All ${totalLayers}/${totalLayers} layers fit inside ${vramBudget}GB VRAM using ${quantMetrics.formatLabel} without RAM spill.`
      );
    } else if (isImageDiffuser || fullMemoryGb <= input.hostRamGb * 0.85) {
      // Partial GPU layer split + sequential RAM offload
      const ratio = Math.max(0.18, Math.min(0.92, safeVramCap / Math.max(0.5, fullMemoryGb)));
      gpuLayersOffloaded = Math.max(4, Math.min(totalLayers - 1, Math.round(totalLayers * ratio)));
      estimatedVramGb = safeVramCap;
      estimatedRamGb = Number(Math.max(1.25, fullMemoryGb - estimatedVramGb + 1.4).toFixed(2));
      requiresCpuOffload = true;
      recommendedBackend = isImageDiffuser
        ? 'DirectML + CPU Offload'
        : isAmd
          ? 'Vulkan Compute (AMD RDNA 2)'
          : 'DirectML + CPU Offload';
      reasons.push(
        `Hybrid layer split places ${gpuLayersOffloaded}/${totalLayers} active blocks in ${vramBudget}GB VRAM and streams remaining weights from ${input.hostRamGb.toFixed(0)}GB system RAM.`
      );
    } else {
      gpuLayersOffloaded = 0;
      estimatedVramGb = 0;
      estimatedRamGb = fullMemoryGb;
      requiresCpuOffload = true;
      recommendedBackend = 'CPU (AVX2 / System RAM)';
      reasons.push('System RAM ceiling reached; falling back to pure AVX2 CPU scheduling.');
    }
  } else {
    gpuLayersOffloaded = 0;
    estimatedVramGb = 0;
    estimatedRamGb = fullMemoryGb;
    requiresCpuOffload = true;
    recommendedBackend = 'CPU (AVX2 / System RAM)';
    reasons.push('No dedicated GPU detected on current host; CPU AVX2 system RAM or Server Gateway active.');
  }

  let tier: CompatibilityTier = 'Recommended';
  const diskSufficient = input.hostFreeDiskGb >= estimatedDiskGb + 2;
  const ramSufficient = input.hostRamGb >= estimatedRamGb + 1.5;

  if (!diskSufficient) {
    tier = 'Unsupported';
    reasons.push(
      `Insufficient disk headroom: requires ${estimatedDiskGb}GB, host reports ${input.hostFreeDiskGb.toFixed(1)}GB free.`
    );
  } else if (!ramSufficient) {
    tier = 'Unsupported';
    reasons.push(
      `Insufficient system RAM: requires ~${estimatedRamGb}GB, host reports ${input.hostRamGb.toFixed(1)}GB.`
    );
  } else if (isImageDiffuser && input.parametersBillion >= 6) {
    tier = 'Compatible with limitations';
    reasons.push(
      `Runs with sequential CPU offload, tiled VAE, and ${quantMetrics.formatLabel} on 4GB VRAM; bounded batch=1 prevents OOM.`
    );
  } else if (input.parametersBillion >= 30 && !quant.includes('Q4') && !quant.includes('AWQ') && !quant.includes('NF4')) {
    tier = 'Experimental';
    reasons.push('Large FP16/Q8 weight footprint runs slowly across DDR5 system RAM bandwidth.');
  } else if (input.parametersBillion >= 18) {
    tier = 'Compatible with limitations';
    reasons.push('Uses partial Vulkan/DirectML layer split + DDR5 RAM offload; lower token/s than <=9B tiers.');
  } else if (requiresCpuOffload && estimatedRamGb > 10) {
    tier = 'Compatible with limitations';
    reasons.push('Runs reliably using system RAM with partial GPU offloading.');
  } else {
    reasons.push('Optimal memory envelope for the host system with minimal swap overhead.');
  }

  // Compute deterministic System Fit Score (0..100) for auto-detecting the best model per hardware
  let fitScore = 50;
  if (tier === 'Unsupported') {
    fitScore = 5;
  } else {
    if (tier === 'Recommended') fitScore += 28;
    else if (tier === 'Compatible with limitations') fitScore += 14;

    fitScore += quantMetrics.vramEfficiencyBonus * 0.6;

    if (input.isGpuAccelerated && vramBudget > 0) {
      const layerCoverage = totalLayers > 0 ? gpuLayersOffloaded / totalLayers : 0;
      fitScore += Math.round(layerCoverage * 22);
      // Sweet spot for RX 6500M 4GB VRAM + 40GB RAM: 3B-8B quantized or <=4.5B image models
      if (input.parametersBillion >= 2.5 && input.parametersBillion <= 9) {
        fitScore += 10;
      } else if (input.parametersBillion > 18) {
        fitScore -= 14;
      }
    } else {
      // On CPU-only hosts, favor fast quantized <= 4B-8B footprints
      if (input.parametersBillion <= 4) fitScore += 18;
      else if (input.parametersBillion <= 9) fitScore += 12;
      else if (input.parametersBillion > 16) fitScore -= 16;
    }

    if (estimatedRamGb > input.hostRamGb * 0.55) {
      fitScore -= 18;
    }
  }
  const systemFitScore = Math.max(0, Math.min(100, Math.round(fitScore)));

  return {
    tier,
    estimatedDiskGb,
    estimatedRamGb,
    estimatedVramGb,
    recommendedBackend,
    supportsCpuFallback: true,
    requiresCpuOffload,
    gpuLayersOffloaded,
    totalLayers,
    systemFitScore,
    reasons,
    qwenLowVramProfile: isQwenImage
      ? {
          sequentialCpuOffload: true,
          vaeTiling: true,
          attentionSlicing: true,
          precision: quant.includes('NF4')
            ? 'bnb-nf4'
            : vramBudget <= 4
              ? 'int8-offload'
              : 'fp16',
          maxRecommendedResolution: vramBudget <= 4 ? '768x768 (1024px tiled)' : '1024x1024',
          maxBatchSize: 1,
        }
      : undefined,
  };
}

/**
 * Inspects the full catalog against detected host hardware and tags the highest-fitting
 * Chat model and Image model as System Best Match recommendations.
 */
export function applySystemBestMatchRecommendations(
  models: ModelEntry[],
  hardware: HardwareSpecs
): ModelEntry[] {
  const candidates = models.filter((m) => m.compatibility.tier !== 'Unsupported');
  const chatCandidates = candidates
    .filter(
      (m) =>
        m.supportedTasks.includes('general_chat') ||
        m.supportedTasks.includes('coding') ||
        m.supportedTasks.includes('reasoning')
    )
    .sort((a, b) => b.compatibility.systemFitScore - a.compatibility.systemFitScore);

  const imageCandidates = candidates
    .filter(
      (m) =>
        m.supportedTasks.includes('image_generation') ||
        m.supportedTasks.includes('image_editing')
    )
    .sort((a, b) => b.compatibility.systemFitScore - a.compatibility.systemFitScore);

  const bestChatId = chatCandidates[0]?.id;
  const bestImageId = imageCandidates[0]?.id;

  const hostProfileSummary = hardware.isGpuAccelerated
    ? `${hardware.gpuName} (${hardware.gpuVramGb}GB VRAM)`
    : `${hardware.totalRamGb.toFixed(0)}GB RAM CPU Host`;

  return models.map((m) => {
    const isBestChat = m.id === bestChatId;
    const isBestImage = m.id === bestImageId;
    return {
      ...m,
      compatibility: {
        ...m.compatibility,
        isSystemBestMatch: isBestChat || isBestImage,
        bestMatchLabel: isBestChat
          ? `Best Chat Match (${hostProfileSummary})`
          : isBestImage
            ? `Best Image Match (${hostProfileSummary})`
            : undefined,
      },
    };
  });
}
