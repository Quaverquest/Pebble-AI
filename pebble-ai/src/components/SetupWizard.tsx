import React, { useState } from 'react';
import { ArrowRight, Check, Cpu, HardDrive, ShieldCheck, Wifi } from 'lucide-react';
import type { HardwareSpecs, ModelEntry, PebbleSettings } from '../core/types';

interface SetupWizardProps {
  hardware: HardwareSpecs;
  models: ModelEntry[];
  settings: PebbleSettings;
  onComplete: (patch: Partial<PebbleSettings>) => Promise<void>;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({
  hardware,
  models,
  settings,
  onComplete,
}) => {
  const [step, setStep] = useState(1);
  const [smartResourceMode, setSmartResourceMode] = useState(settings.smartResourceMode);
  const [qwenLowVramEnabled, setQwenLowVramEnabled] = useState(settings.qwenLowVramEnabled);
  const [idleUnloadSeconds, setIdleUnloadSeconds] = useState(settings.idleUnloadSeconds);
  const [remoteEnabled, setRemoteEnabled] = useState(settings.remoteEnabled);
  const [saving, setSaving] = useState(false);

  const totalCatalogDiskGb = models
    .filter((m) => m.installed)
    .reduce((acc, m) => acc + m.diskSizeGb, 0)
    .toFixed(1);

  const handleFinish = async () => {
    setSaving(true);
    try {
      await onComplete({
        setupCompleted: true,
        smartResourceMode,
        qwenLowVramEnabled,
        idleUnloadSeconds,
        remoteEnabled,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-3xl rounded-2xl pebble-glass p-8 space-y-6">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--pebble-panel-border)] pb-5">
          <div>
            <p className="text-xs font-mono text-emerald-700 dark:text-emerald-400">
              First-Run Configuration · Step {step} of 3
            </p>
            <h1 className="font-display text-2xl font-semibold text-neutral-950 dark:text-white mt-1 text-balance">
              Initialize Pebble AI for Your Hardware
            </h1>
          </div>
          <button
            type="button"
            onClick={handleFinish}
            className="px-3.5 py-2 rounded-lg text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-950 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.06] transition-colors whitespace-nowrap shrink-0"
          >
            Skip to Workspace
          </button>
        </div>

        {step === 1 && (
          <div className="space-y-5">
            <p className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">
              Pebble AI inspects your live machine resources and configures execution backends for reliable local inference without CUDA dependencies.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-[#131618] space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                  <Cpu className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Detected Host Hardware</span>
                </div>
                <div className="text-sm font-semibold text-neutral-950 dark:text-white">
                  {hardware.cpuModel}
                </div>
                <div className="text-xs font-mono text-neutral-600 dark:text-neutral-400 space-y-1 tabular-nums">
                  <div>OS: {hardware.platform} ({hardware.arch})</div>
                  <div>RAM: {hardware.totalRamGb} GB Total · {hardware.freeRamGb} GB Free</div>
                  <div>Disk: {hardware.diskFreeGb} GB Free / {hardware.diskTotalGb} GB</div>
                  <div>GPU: {hardware.gpuName}</div>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-[#131618] space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                  <HardDrive className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Target Deployment Profile</span>
                </div>
                <div className="text-sm font-semibold text-neutral-950 dark:text-white">
                  {hardware.targetProfile.deviceName} · {hardware.targetProfile.os}
                </div>
                <div className="text-xs font-mono text-neutral-600 dark:text-neutral-400 space-y-1 tabular-nums">
                  <div>CPU: {hardware.targetProfile.cpu}</div>
                  <div>GPU: {hardware.targetProfile.gpu} ({hardware.targetProfile.vramGb} GB VRAM)</div>
                  <div>Memory: {hardware.targetProfile.ramGb} GB DDR5 System RAM</div>
                  <div>Storage: {hardware.targetProfile.storage}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">
              Configure Smart Resource layer offloading and review the zero-download-required Pebble AI Tiny through Ultra suite.
            </p>

            <label className="flex items-start gap-3 p-4 rounded-xl border border-neutral-200 dark:border-white/10 cursor-pointer hover:bg-neutral-50 dark:hover:bg-white/[0.03]">
              <input
                type="checkbox"
                checked={smartResourceMode}
                onChange={(e) => setSmartResourceMode(e.target.checked)}
                className="mt-1 accent-emerald-700"
              />
              <div>
                <div className="text-sm font-semibold text-neutral-950 dark:text-white">
                  Enable Smart Resource Mode (Recommended for 4GB VRAM)
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                  Uses Vulkan Compute layer splitting + DirectML CPU offload, keeps Whisper/TTS in 40GB RAM, and unloads idle models after {idleUnloadSeconds}s.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 p-4 rounded-xl border border-neutral-200 dark:border-white/10 cursor-pointer hover:bg-neutral-50 dark:hover:bg-white/[0.03]">
              <input
                type="checkbox"
                checked={qwenLowVramEnabled}
                onChange={(e) => setQwenLowVramEnabled(e.target.checked)}
                className="mt-1 accent-emerald-700"
              />
              <div>
                <div className="text-sm font-semibold text-neutral-950 dark:text-white">
                  Image Low-VRAM DirectML Sequential Offload & Tiled VAE
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                  Splits Pebble Image & Qwen Image 2.1 pipelines across 4GB RX 6500M VRAM and 40GB system RAM with CPU fallback to prevent OOM crashes.
                </p>
              </div>
            </label>

            <div className="p-4 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-[#131618] flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-neutral-950 dark:text-white">
                  Instant Mount & Quantized Catalog ({models.length} Models Ready)
                </div>
                <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                  No mandatory downloads required. Optional offline cache (~{totalCatalogDiskGb} GB quantized) uses {settings.modelStorageDir}.
                </div>
              </div>
              <select
                aria-label="Idle model unload timeout"
                value={idleUnloadSeconds}
                onChange={(e) => setIdleUnloadSeconds(Number(e.target.value))}
                className="px-3 py-2 rounded-lg border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#181B1E] text-xs font-mono text-neutral-900 dark:text-neutral-100"
              >
                <option value={120}>Idle Unload: 2 min</option>
                <option value={300}>Idle Unload: 5 min</option>
                <option value={600}>Idle Unload: 10 min</option>
              </select>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">
              Initialize Pebble Routers (featuring Pebble Omni) and optionally enable Household Wi-Fi Remote Access for devices on your local network.
            </p>

            <label className="flex items-start gap-3 p-4 rounded-xl border border-neutral-200 dark:border-white/10 cursor-pointer hover:bg-neutral-50 dark:hover:bg-white/[0.03]">
              <input
                type="checkbox"
                checked={remoteEnabled}
                onChange={(e) => setRemoteEnabled(e.target.checked)}
                className="mt-1 accent-emerald-700"
              />
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-neutral-950 dark:text-white">
                  <Wifi className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Enable Household Wi-Fi Remote Access (LAN-Only)</span>
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Requires 6-digit PIN pairing ({settings.remotePin}). No public internet exposure or router port forwarding.
                </p>
              </div>
            </label>

            <div className="p-4 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-[#131618] flex items-center gap-3 text-xs text-neutral-600 dark:text-neutral-300">
              <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>
                Pebble Omni Router initialized with Automatic mode, AMD {hardware.amdAcceleration.preferredBackend.replace(/_/g, ' ')} tuning, and persistent storage.
              </span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-neutral-200 dark:border-white/10">
          <div className="flex items-center gap-2">
            {[1, 2, 3].map((idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setStep(idx)}
                className={`h-2 rounded-full transition-all ${
                  step === idx ? 'w-7 bg-emerald-700 dark:bg-emerald-500' : 'w-2 bg-neutral-300 dark:bg-white/20'
                }`}
                aria-label={`Go to wizard step ${idx}`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2.5">
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className="px-4 py-2 rounded-xl border border-neutral-200 dark:border-white/10 text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.06] transition-colors whitespace-nowrap"
              >
                Back
              </button>
            )}
            {step < 3 ? (
              <button
                type="button"
                onClick={() => setStep(step + 1)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <span>Continue</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={handleFinish}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <Check className="w-4 h-4" />
                <span>{saving ? 'Initializing...' : 'Launch Pebble AI'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
