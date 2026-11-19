import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  AmdAccelerationStatus,
  ExecutionBackend,
  HardwareSpecs,
  NetworkEndpoint,
  PebbleSettings,
} from '../src/core/types';

const execFileAsync = promisify(execFile);

let prevCpuTimes: { idle: number; total: number } | null = null;

function sampleCpuUsagePercent(): number {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.irq +
      cpu.times.idle;
  }

  if (!prevCpuTimes) {
    prevCpuTimes = { idle, total };
    const load1m = os.loadavg()[0] ?? 0;
    return Math.min(98, Math.max(2, Math.round((load1m / Math.max(1, cpus.length)) * 100)));
  }

  const idleDelta = idle - prevCpuTimes.idle;
  const totalDelta = total - prevCpuTimes.total;
  prevCpuTimes = { idle, total };

  if (totalDelta <= 0) return 4;
  return Math.min(100, Math.max(1, Math.round((1 - idleDelta / totalDelta) * 100)));
}

function getDiskMetrics(): { diskTotalGb: number; diskFreeGb: number } {
  try {
    const stat = fs.statfsSync(process.cwd());
    const totalBytes = Number(stat.blocks) * Number(stat.bsize);
    const freeBytes = Number(stat.bavail) * Number(stat.bsize);
    return {
      diskTotalGb: Number((totalBytes / 1024 ** 3).toFixed(1)),
      diskFreeGb: Number((freeBytes / 1024 ** 3).toFixed(1)),
    };
  } catch {
    return { diskTotalGb: 0, diskFreeGb: 0 };
  }
}

export function detectLanEndpoints(port: number): NetworkEndpoint[] {
  const nets = os.networkInterfaces();
  const endpoints: NetworkEndpoint[] = [];

  for (const [name, addrs] of Object.entries(nets)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        endpoints.push({
          name,
          address: addr.address,
          port,
          url: `http://${addr.address}:${port}`,
          remoteClientUrl: `http://${addr.address}:${port}/remote`,
        });
      }
    }
  }

  const isPrivateLan = (ip: string) =>
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

  return endpoints.sort((a, b) => Number(isPrivateLan(b.address)) - Number(isPrivateLan(a.address)));
}

async function probeWorker(url: string, healthPath = '/'): Promise<boolean> {
  if (!url) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 350);
    const target = `${url.replace(/\/+$/, '')}${healthPath}`;
    const res = await fetch(target, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

async function commandExists(cmd: string, args: string[] = ['--version']): Promise<boolean> {
  try {
    await execFileAsync(cmd, args, { timeout: 900 });
    return true;
  } catch {
    return false;
  }
}

async function probeGpu(): Promise<{
  gpuName: string;
  gpuVendor: string;
  gpuVramGb: number;
  gpuDriverBackend: string;
  isGpuAccelerated: boolean;
  amdAcceleration: AmdAccelerationStatus;
}> {
  if (process.platform === 'win32') {
    let vulkanAvailable = fs.existsSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'vulkan-1.dll'));
    if (!vulkanAvailable) {
      vulkanAvailable = await commandExists('vulkaninfo', ['--summary']);
    }
    const directmlAvailable = fs.existsSync(
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'DirectML.dll')
    );
    const rocmAvailable = await commandExists('hipinfo', []);

    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json',
        ],
        { timeout: 1500 }
      );
      const parsed = JSON.parse(stdout);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const dedicated =
        list.find((g) => /radeon|nvidia|arc|rtx|rx /i.test(g?.Name ?? '')) ?? list[0];

      if (dedicated?.Name) {
        const vramBytes = Number(dedicated.AdapterRAM || 0);
        const vramGb = vramBytes > 0 ? Number((vramBytes / 1024 ** 3).toFixed(1)) : 4;
        const isAmd = /amd|radeon/i.test(dedicated.Name);
        const preferredBackend: ExecutionBackend = isAmd
          ? vulkanAvailable
            ? 'Vulkan Compute (AMD RDNA 2)'
            : directmlAvailable
              ? 'DirectML + CPU Offload'
              : 'CPU (AVX2 / System RAM)'
          : directmlAvailable
            ? 'DirectML + CPU Offload'
            : 'CPU (AVX2 / System RAM)';

        return {
          gpuName: dedicated.Name,
          gpuVendor: isAmd ? 'AMD' : 'Generic GPU',
          gpuVramGb: vramGb,
          gpuDriverBackend: `${preferredBackend} (${vulkanAvailable ? 'Vulkan' : 'No Vulkan'} · ${directmlAvailable ? 'DirectML' : 'No DirectML'})`,
          isGpuAccelerated: true,
          amdAcceleration: {
            vulkanAvailable,
            directmlAvailable,
            rocmAvailable,
            preferredBackend,
            notes: [
              vulkanAvailable
                ? 'Vulkan Compute detected (llama.cpp / Ollama GPU layer splitting active for RDNA 2).'
                : 'Install Adrenalin 24.x+ drivers to enable Vulkan Compute.',
              directmlAvailable
                ? 'DirectML detected (torch-directml sequential CPU offload + VAE tiling enabled for diffusion).'
                : 'DirectML runtime not detected; image models use CPU fallback.',
              rocmAvailable
                ? 'HIP/ROCm runtime found (experimental for RDNA 2 gfx1034 on Windows).'
                : 'Windows ROCm SDK targets RDNA 3+; RDNA 2 RX 6500M uses Vulkan Compute + DirectML by design.',
            ],
          },
        };
      }
    } catch {
      // Fallback below
    }
  }

  // Honest non-Windows / container detection without spoofing fake GPU attachment
  return {
    gpuName: 'No Dedicated GPU Attached (CPU / Gateway Runtime)',
    gpuVendor: 'Host CPU',
    gpuVramGb: 0,
    gpuDriverBackend: 'CPU AVX2 / Server Gateway (Target: AMD RX 6500M 4GB Vulkan + DirectML)',
    isGpuAccelerated: false,
    amdAcceleration: {
      vulkanAvailable: false,
      directmlAvailable: false,
      rocmAvailable: false,
      preferredBackend: 'CPU (AVX2 / System RAM)',
      notes: [
        'Host environment has no attached AMD RDNA 2 GPU; CPU AVX2 + @google/genai gateway fallback active.',
        'When deployed on HP Victus 15 (Windows 11 + RX 6500M), Vulkan Compute handles GGUF/AWQ LLM layer splits and DirectML handles diffusion.',
      ],
    },
  };
}

let cachedGpu: Awaited<ReturnType<typeof probeGpu>> | null = null;

export async function inspectHardware(
  settings: PebbleSettings,
  activeVramAllocatedGb: number
): Promise<HardwareSpecs> {
  if (!cachedGpu) {
    cachedGpu = await probeGpu();
  }

  const cpus = os.cpus();
  const rawCpuModel = cpus[0]?.model?.trim();
  const cpuModel =
    !rawCpuModel || rawCpuModel.toLowerCase() === 'unknown'
      ? `${os.arch()} Host Processor (${cpus.length} threads)`
      : rawCpuModel;
  const totalRamGb = Number((os.totalmem() / 1024 ** 3).toFixed(2));
  const freeRamGb = Number((os.freemem() / 1024 ** 3).toFixed(2));
  const usedRamGb = Number(Math.max(0, totalRamGb - freeRamGb).toFixed(2));
  const ramUsagePercent = totalRamGb > 0 ? Math.round((usedRamGb / totalRamGb) * 100) : 0;
  const { diskTotalGb, diskFreeGb } = getDiskMetrics();

  const [ollamaOnline, qwenImageOnline, voiceOnline] = await Promise.all([
    probeWorker(settings.localWorkers.ollamaUrl, '/api/tags'),
    probeWorker(settings.localWorkers.qwenImageUrl, '/health'),
    probeWorker(settings.localWorkers.voiceWorkerUrl, '/health'),
  ]);

  return {
    detectedAt: new Date().toISOString(),
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    osRelease: os.release(),
    cpuModel,
    cpuCores: Math.max(1, Math.floor(cpus.length / 2)),
    cpuThreads: cpus.length,
    totalRamGb,
    freeRamGb,
    usedRamGb,
    ramUsagePercent,
    cpuLoadPercent: sampleCpuUsagePercent(),
    diskTotalGb,
    diskFreeGb,
    gpuName: cachedGpu.gpuName,
    gpuVendor: cachedGpu.gpuVendor,
    gpuVramGb: cachedGpu.gpuVramGb,
    gpuVramUsedGb: Number(activeVramAllocatedGb.toFixed(2)),
    gpuDriverBackend: cachedGpu.gpuDriverBackend,
    isGpuAccelerated: cachedGpu.isGpuAccelerated,
    amdAcceleration: cachedGpu.amdAcceleration,
    networkInterfaces: detectLanEndpoints(settings.remotePort),
    activeWorkers: {
      ollama: ollamaOnline,
      qwenImage: qwenImageOnline,
      voice: voiceOnline,
      cloudGateway: Boolean(process.env.GEMINI_API_KEY),
    },
    targetProfile: {
      deviceName: 'HP Victus 15',
      cpu: 'AMD Ryzen 5 7535HS',
      gpu: 'AMD Radeon RX 6500M',
      vramGb: 4,
      ramGb: 40,
      storage: '1TB Samsung NVMe SSD',
      os: 'Windows 11 (RDNA 2 Vulkan + DirectML)',
    },
  };
}
