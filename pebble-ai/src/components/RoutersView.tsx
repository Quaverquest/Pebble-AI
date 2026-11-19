import React, { useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  GitBranch,
  Layers,
  Play,
  Power,
  PowerOff,
  Sliders,
} from 'lucide-react';
import { isModelActiveInMemory } from '../core/lifecycle';
import { getRouterProfile, ROUTER_PROFILES } from '../core/omni';
import type {
  HardwareSpecs,
  MemoryHistoryPoint,
  ModelEntry,
  OmniMode,
  OmniRoutingDecision,
  PebbleSettings,
  QueuedModelTask,
  RouterId,
} from '../core/types';

interface RoutersViewProps {
  settings: PebbleSettings;
  hardware: HardwareSpecs;
  models: ModelEntry[];
  queue: QueuedModelTask[];
  routingHistory: OmniRoutingDecision[];
  memoryHistory: MemoryHistoryPoint[];
  embedded?: boolean;
  onStateRefresh: () => Promise<void>;
}

interface DryRunResult {
  route: {
    routerName: string;
    detectedTask: string;
    selectedModel: ModelEntry;
    backendUsed: string;
    reasoning: string;
  };
  offloadPlan: {
    targetStatus: string;
    allocatedVramGb: number;
    allocatedRamGb: number;
    gpuLayersLoaded: number;
    modelsToUnload: Array<{ name: string }>;
    reason: string;
  };
}

export const RoutersView: React.FC<RoutersViewProps> = ({
  settings,
  hardware,
  models,
  queue,
  routingHistory,
  memoryHistory,
  embedded = false,
  onStateRefresh,
}) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [simPrompt, setSimPrompt] = useState(
    'Make a realistic architectural photograph of a lakeside studio'
  );
  const [simResult, setSimResult] = useState<DryRunResult | null>(null);
  const [simulating, setSimulating] = useState(false);

  const activeRouter = getRouterProfile(settings.activeRouterId);
  const activeModels = models.filter((m) => isModelActiveInMemory(m));
  const latestDecision = routingHistory[0] ?? null;

  const updateRouterConfig = async (patch: {
    routerId?: RouterId;
    mode?: OmniMode;
    allowUncensoredModels?: boolean;
    preferredQuantization?: PebbleSettings['preferredQuantization'];
  }) => {
    await fetch('/api/routers/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    await onStateRefresh();
  };

  const handleLoadModel = async (modelId: string, forceCpuFallback = false) => {
    setBusyId(modelId);
    try {
      await fetch('/api/models/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId, forceCpuFallback }),
      });
      await onStateRefresh();
    } finally {
      setBusyId(null);
    }
  };

  const handleUnloadModel = async (modelId: string) => {
    setBusyId(modelId);
    try {
      await fetch('/api/models/unload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId }),
      });
      await onStateRefresh();
    } finally {
      setBusyId(null);
    }
  };

  const runDryRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simPrompt.trim()) return;
    setSimulating(true);
    try {
      const res = await fetch('/api/routers/dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: simPrompt.trim() }),
      });
      if (res.ok) {
        setSimResult(await res.json());
      }
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div className={embedded ? 'space-y-6' : 'max-w-[1320px] mx-auto px-6 py-6 space-y-6'}>
      {/* Header + Mode Policy */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--pebble-panel-border)] pb-4">
        <div>
          <h2 className={`font-display font-semibold ${embedded ? 'text-xl' : 'text-2xl'}`}>
            AI Routers &amp; Intelligent Layer Offload
          </h2>
          <p className="text-xs text-[var(--pebble-text-secondary)] mt-1">
            Switch between Pebble Omni and specialized hardware or creative routers across Tiny, Small, Normal, and Ultra models.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-xl pebble-glass-subtle">
          {(['automatic', 'balanced', 'manual'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => void updateRouterConfig({ mode })}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium capitalize whitespace-nowrap ${
                settings.omniMode === mode
                  ? 'pebble-accent-btn'
                  : 'text-[var(--pebble-text-secondary)]'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Router Selector Profiles */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {ROUTER_PROFILES.map((router) => {
          const isSelected = settings.activeRouterId === router.id;
          return (
            <button
              key={router.id}
              type="button"
              onClick={() => void updateRouterConfig({ routerId: router.id })}
              className={`text-left rounded-2xl border p-4 space-y-2 transition-colors ${
                isSelected
                  ? 'border-[var(--pebble-accent)] bg-emerald-700/15'
                  : 'pebble-glass hover:border-[var(--pebble-accent)]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <GitBranch className={`w-4 h-4 ${isSelected ? 'text-[var(--pebble-accent)]' : 'text-[var(--pebble-text-secondary)]'}`} />
                  <span className="font-display text-sm font-semibold">
                    {router.name}
                  </span>
                </div>
                {isSelected && <CheckCircle2 className="w-4 h-4 text-[var(--pebble-accent)] shrink-0" />}
              </div>
              <div className="text-[11px] font-mono text-[var(--pebble-accent)]">
                {router.tagline}
              </div>
              <p className="text-xs text-[var(--pebble-text-secondary)] leading-relaxed">
                {router.description}
              </p>
            </button>
          );
        })}
      </section>

      {/* Router Policy Controls + Dry Run */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5 rounded-2xl pebble-glass p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold flex items-center gap-2">
              <Sliders className="w-4 h-4 text-[var(--pebble-accent)]" />
              <span>{activeRouter.name} Policies</span>
            </h3>
            <span className="text-xs font-mono text-[var(--pebble-text-secondary)]">
              {hardware.amdAcceleration.preferredBackend}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <label className="flex items-center justify-between p-3 rounded-xl pebble-glass-subtle cursor-pointer">
              <span>Allow Uncensored Routing</span>
              <input
                type="checkbox"
                checked={settings.allowUncensoredModels}
                onChange={(e) => void updateRouterConfig({ allowUncensoredModels: e.target.checked })}
                className="accent-emerald-700"
              />
            </label>

            <div className="p-2.5 rounded-xl pebble-glass-subtle">
              <label htmlFor="pref-quant" className="block text-[11px] text-[var(--pebble-text-secondary)] mb-1">
                Preferred Quantization
              </label>
              <select
                id="pref-quant"
                value={settings.preferredQuantization}
                onChange={(e) =>
                  void updateRouterConfig({
                    preferredQuantization: e.target.value as PebbleSettings['preferredQuantization'],
                  })
                }
                className="w-full bg-transparent text-xs font-mono focus:outline-none"
              >
                <option value="auto">Auto (Optimal VRAM Fit)</option>
                <option value="AWQ">AWQ (4-bit GPU Fast)</option>
                <option value="GPTQ">GPTQ (4-bit Hybrid)</option>
                <option value="BNB_NF4">bitsandbytes NF4</option>
                <option value="Q4_K_M">GGUF Q4_K_M (Vulkan)</option>
              </select>
            </div>
          </div>

          <div className="text-xs text-[var(--pebble-text-secondary)] space-y-1">
            {hardware.amdAcceleration.notes.slice(0, 2).map((note, idx) => (
              <div key={idx}>· {note}</div>
            ))}
          </div>
        </div>

        {/* Live Route Dry-Run Simulator */}
        <div className="lg:col-span-7 rounded-2xl pebble-glass p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold">
              Live Router Dry-Run &amp; Layer Offload Inspector
            </h3>
            <span className="text-xs font-mono text-[var(--pebble-text-secondary)] tabular-nums">
              VRAM {hardware.gpuVramUsedGb}/{settings.maxVramBudgetGb}G · RAM {hardware.usedRamGb}/{hardware.totalRamGb}G
            </span>
          </div>

          <form onSubmit={runDryRun} className="flex items-center gap-2">
            <input
              type="text"
              value={simPrompt}
              onChange={(e) => setSimPrompt(e.target.value)}
              placeholder="Enter any prompt to inspect routing & GPU/RAM layer split..."
              aria-label="Test prompt for route simulator"
              className="flex-1 px-3.5 py-2 rounded-xl pebble-glass-subtle text-xs"
            />
            <button
              type="submit"
              disabled={simulating}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl pebble-accent-btn text-xs font-semibold whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{simulating ? 'Inspecting...' : 'Simulate Route'}</span>
            </button>
          </form>

          {simResult ? (
            <div className="p-3.5 rounded-xl border border-emerald-600/35 bg-emerald-700/15 text-xs space-y-1">
              <div className="font-semibold">
                {simResult.route.routerName} → {simResult.route.selectedModel.name} ({simResult.route.selectedModel.quantization})
              </div>
              <div className="font-mono text-[var(--pebble-accent)] tabular-nums">
                Task: {simResult.route.detectedTask.replace(/_/g, ' ')} · Layers on GPU: {simResult.offloadPlan.gpuLayersLoaded}/{simResult.route.selectedModel.compatibility.totalLayers} · Alloc: {simResult.offloadPlan.allocatedVramGb}G VRAM / {simResult.offloadPlan.allocatedRamGb}G RAM
              </div>
              <div className="text-[var(--pebble-text-secondary)]">{simResult.route.reasoning}</div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 pt-1 text-xs">
              <div className="p-3 rounded-xl pebble-glass-subtle">
                <div className="text-[var(--pebble-text-secondary)]">Last Selected</div>
                <div className="font-medium truncate mt-0.5">
                  {latestDecision?.selectedModelName || activeModels[0]?.name || 'On-Demand'}
                </div>
              </div>
              <div className="p-3 rounded-xl pebble-glass-subtle">
                <div className="text-[var(--pebble-text-secondary)]">Active / Queue</div>
                <div className="font-mono tabular-nums mt-0.5">
                  {activeModels.length} active · {queue.length} queued
                </div>
              </div>
              <div className="p-3 rounded-xl pebble-glass-subtle">
                <div className="text-[var(--pebble-text-secondary)]">Idle Reclaim</div>
                <div className="font-mono tabular-nums mt-0.5">
                  {settings.idleUnloadSeconds}s timeout
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Model Lifecycle Table */}
      <div className="rounded-2xl pebble-glass overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--pebble-panel-border)] flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-sm font-semibold flex items-center gap-2">
            <Layers className="w-4 h-4 text-[var(--pebble-accent)]" />
            <span>Model Lifecycle, Quantization &amp; GPU Layer Offloading</span>
          </h3>
          <span className="text-xs text-[var(--pebble-text-secondary)]">
            Smart Resource Mode splits layers between {settings.maxVramBudgetGb}GB VRAM &amp; {settings.maxRamBudgetGb}GB RAM
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[var(--pebble-panel-border)] text-[var(--pebble-text-secondary)]">
              <tr>
                <th className="py-3 px-4 font-medium">Model</th>
                <th className="py-3 px-4 font-medium">Quantization</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium">GPU Layers</th>
                <th className="py-3 px-4 font-medium">Backend</th>
                <th className="py-3 px-4 font-medium text-right">Est. (VRAM / RAM)</th>
                <th className="py-3 px-4 font-medium text-right">Controls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--pebble-panel-border)]">
              {models.map((m) => {
                const loaded = isModelActiveInMemory(m);
                const gpuLayers = loaded ? (m.gpuLayersLoaded ?? m.compatibility.gpuLayersOffloaded) : m.compatibility.gpuLayersOffloaded;
                return (
                  <tr key={m.id} className="hover:bg-white/[0.04]">
                    <td className="py-3 px-4">
                      <div className="font-medium">{m.name}</div>
                      <div className="text-[11px] font-mono text-[var(--pebble-text-secondary)]">
                        {m.tier ? `${m.tier} · ` : ''}{m.censorship || 'standard'} · {m.priority} priority
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono">{m.quantization}</td>
                    <td className="py-3 px-4 font-mono">
                      <span className={loaded ? 'text-emerald-500 font-medium' : 'text-[var(--pebble-text-secondary)]'}>
                        {m.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums">
                      {gpuLayers} / {m.compatibility.totalLayers}
                    </td>
                    <td className="py-3 px-4 text-[var(--pebble-text-secondary)]">
                      {m.compatibility.recommendedBackend}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-[var(--pebble-text-secondary)]">
                      {m.compatibility.estimatedVramGb}G / {m.compatibility.estimatedRamGb}G
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {loaded ? (
                          <button
                            type="button"
                            disabled={busyId === m.id}
                            onClick={() => void handleUnloadModel(m.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg pebble-glass-subtle hover:opacity-85"
                          >
                            <PowerOff className="w-3 h-3" />
                            <span>Unload</span>
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={busyId === m.id}
                              onClick={() => void handleLoadModel(m.id, false)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg pebble-accent-btn"
                            >
                              <Power className="w-3 h-3" />
                              <span>Load</span>
                            </button>
                            <button
                              type="button"
                              disabled={busyId === m.id}
                              onClick={() => void handleLoadModel(m.id, true)}
                              className="px-2 py-1 rounded-lg pebble-glass-subtle"
                              title="Force CPU System RAM execution"
                            >
                              CPU
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Routing History & Memory History */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-8 rounded-2xl pebble-glass p-5 space-y-3">
          <h3 className="font-display text-sm font-semibold flex items-center gap-2">
            <Cpu className="w-4 h-4 text-[var(--pebble-accent)]" />
            <span>Routing Decision History</span>
          </h3>
          {routingHistory.length === 0 ? (
            <p className="text-xs text-[var(--pebble-text-secondary)] py-4">
              No routing decisions logged yet. Send a message in Chat or run Simulate Route above.
            </p>
          ) : (
            <div className="divide-y divide-[var(--pebble-panel-border)] text-xs">
              {routingHistory.slice(0, 12).map((item) => (
                <div key={item.id} className="py-2.5 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {item.selectedModelName} · {item.detectedTask.replace(/_/g, ' ')}
                    </span>
                    <span className="font-mono text-[var(--pebble-text-secondary)] tabular-nums">
                      {item.latencyMs}ms · {item.status}
                    </span>
                  </div>
                  <div className="text-[var(--pebble-text-secondary)]">
                    {item.reasoning}
                    {item.unloadedModels.length > 0 && ` (Evicted: ${item.unloadedModels.join(', ')})`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-4 rounded-2xl pebble-glass p-5 space-y-3">
          <h3 className="font-display text-sm font-semibold">
            Memory Usage History
          </h3>
          <div className="space-y-2 text-xs font-mono tabular-nums max-h-72 overflow-y-auto">
            {memoryHistory
              .slice()
              .reverse()
              .slice(0, 14)
              .map((pt, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between py-1.5 border-b border-[var(--pebble-panel-border)]"
                >
                  <span className="text-[var(--pebble-text-secondary)]">
                    {new Date(pt.timestamp).toLocaleTimeString()}
                  </span>
                  <span>
                    VRAM {pt.vramUsedGb}G · RAM {pt.ramUsedGb}G
                  </span>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
};
