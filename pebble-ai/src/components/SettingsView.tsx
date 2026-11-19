import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Code2,
  Cpu,
  Download,
  FileCode,
  GitBranch,
  Image as ImageIcon,
  Palette,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Upload,
  Wifi,
} from 'lucide-react';
import { THEME_PRESETS } from '../core/themes';
import type {
  BackgroundAnimationStyle,
  HardwareSpecs,
  MemoryHistoryPoint,
  ModelEntry,
  OmniRoutingDecision,
  PebbleSettings,
  QueuedModelTask,
  RemoteDevice,
  RouterId,
  ThemePresetId,
} from '../core/types';
import { ROUTER_PROFILES } from '../core/omni';
import { ModelsView } from './ModelsView';
import { RemoteView } from './RemoteView';
import { RoutersView } from './RoutersView';

export type SettingsSubTab = 'appearance' | 'models' | 'routers' | 'remote' | 'general';

interface SettingsViewProps {
  settings: PebbleSettings;
  hardware: HardwareSpecs;
  models: ModelEntry[];
  queue: QueuedModelTask[];
  routingHistory: OmniRoutingDecision[];
  memoryHistory: MemoryHistoryPoint[];
  remoteDevices: RemoteDevice[];
  onUpdateSettings: (patch: Partial<PebbleSettings>) => Promise<void>;
  onStateRefresh: () => Promise<void>;
}

const ANIMATION_OPTIONS: Array<{
  id: BackgroundAnimationStyle;
  label: string;
  desc: string;
}> = [
  { id: 'aurora', label: 'Aurora Veil', desc: 'Soft shifting radial gradient clouds' },
  { id: 'mesh_drift', label: 'Mesh Drift', desc: 'Slow translucent daylight shimmer' },
  { id: 'particles', label: 'Ambient Particles', desc: 'Calm drifting light motes' },
  { id: 'starfield', label: 'Deep Starfield', desc: 'Parallax astronomical depth' },
  { id: 'none', label: 'Static Canvas', desc: 'Minimal stationary backdrop' },
];

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  hardware,
  models,
  queue,
  routingHistory,
  memoryHistory,
  remoteDevices,
  onUpdateSettings,
  onStateRefresh,
}) => {
  const [subTab, setSubTab] = useState<SettingsSubTab>('appearance');
  const [draft, setDraft] = useState<PebbleSettings>(settings);
  const [savedNotice, setSavedNotice] = useState(false);
  const [adaptingBg, setAdaptingBg] = useState(false);
  const [bgError, setBgError] = useState<string | null>(null);
  const [bgRationale, setBgRationale] = useState<string | null>(null);
  const [preferLightAdapt, setPreferLightAdapt] = useState<boolean>(false);
  const [windowsFiles, setWindowsFiles] = useState<
    Array<{ key: string; exists: boolean; sizeBytes: number }>
  >([]);
  const bgUploadRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    fetch('/api/windows/files')
      .then((r) => r.json())
      .then((d) => setWindowsFiles(d.files ?? []))
      .catch(() => {});
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await onUpdateSettings(draft);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  const handleSelectThemePreset = async (presetId: ThemePresetId) => {
    const preset = THEME_PRESETS.find((p) => p.id === presetId) ?? THEME_PRESETS[0];
    await onUpdateSettings({
      themePreset: preset.id,
      theme: preset.tokens.isDark ? 'dark' : 'light',
      backgroundAnimation: preset.defaultAnimation,
      aiCustomTheme: null,
    });
  };

  const handleBackgroundFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBgError(null);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result);
      await onUpdateSettings({
        customBackgroundUrl: dataUrl,
      });
      await runAiBackgroundAdaptation(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const runAiBackgroundAdaptation = async (imageDataUrl?: string) => {
    const sourceUrl = imageDataUrl || settings.customBackgroundUrl;
    if (!sourceUrl) return;
    setAdaptingBg(true);
    setBgError(null);
    try {
      const res = await fetch('/api/theme/adapt-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataUrl: sourceUrl,
          preferLight: preferLightAdapt,
          applyImmediately: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Theme AI adaptation failed');
      setBgRationale(
        `${data.rationale || 'Adapted frosted glass panels & accent palette around your wallpaper.'} (${data.usedModel})`
      );
      await onStateRefresh();
    } catch (err) {
      setBgError((err as Error).message);
    } finally {
      setAdaptingBg(false);
    }
  };

  const handleClearCustomBackground = async () => {
    setBgRationale(null);
    setBgError(null);
    await onUpdateSettings({
      customBackgroundUrl: undefined,
      aiCustomTheme: null,
    });
  };

  const subTabs: Array<{
    id: SettingsSubTab;
    label: string;
    icon: React.FC<{ className?: string }>;
  }> = [
    { id: 'appearance', label: 'Appearance & Themes', icon: Palette },
    { id: 'models', label: settings.developerMode ? 'Models & HF Hub' : 'Built-in Models', icon: Cpu },
    { id: 'routers', label: 'Routers', icon: GitBranch },
    { id: 'remote', label: 'Remote Access', icon: Wifi },
    { id: 'general', label: 'Developer & System', icon: Code2 },
  ];

  return (
    <div className="max-w-[1320px] mx-auto px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--pebble-panel-border)] pb-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">
            Settings, Themes &amp; Ecosystem Control
          </h1>
          <p className="text-xs text-[var(--pebble-text-secondary)] mt-1">
            Customize themes, animated wallpapers with AI UI restyling, built-in models, routers, remote access, and Developer Mode.
          </p>
        </div>

        {/* Sub-tab Strip */}
        <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl pebble-glass-subtle">
          {subTabs.map((t) => {
            const Icon = t.icon;
            const active = subTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSubTab(t.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'pebble-accent-btn shadow-sm'
                    : 'text-[var(--pebble-text-secondary)] hover:text-[var(--pebble-text-primary)]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* APPEARANCE, THEMES, ANIMATED BACKGROUNDS & AI WALLPAPER RESTYLING */}
      {subTab === 'appearance' && (
        <div className="space-y-6">
          {/* 8 Built-In Themes */}
          <section className="rounded-2xl pebble-glass p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-base font-semibold">
                  Built-In Acrylic &amp; Mica Themes
                </h2>
                <p className="text-xs text-[var(--pebble-text-secondary)] mt-0.5">
                  Pick from 8 curated frosted glass surfaces, from dark forest acrylic to sunlit daylight porcelain.
                </p>
              </div>
              <span className="text-xs font-mono text-[var(--pebble-accent)]">
                Active: {settings.aiCustomTheme && settings.customBackgroundUrl ? 'AI Adapted Wallpaper Theme' : THEME_PRESETS.find((p) => p.id === settings.themePreset)?.name ?? 'Misty Evergreen'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              {THEME_PRESETS.map((preset) => {
                const selected =
                  settings.themePreset === preset.id && !settings.aiCustomTheme;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => void handleSelectThemePreset(preset.id)}
                    className={`text-left rounded-2xl border p-3.5 space-y-2.5 transition-all ${
                      selected
                        ? 'border-[var(--pebble-accent)] ring-1 ring-[var(--pebble-accent)]'
                        : 'border-[var(--pebble-panel-border)] hover:border-[var(--pebble-accent)]'
                    }`}
                  >
                    <div
                      className="h-16 rounded-xl border border-white/15 p-2 flex items-end justify-between"
                      style={{ background: preset.tokens.backdropGradient }}
                    >
                      <span
                        className="px-2 py-0.5 rounded-md text-[10px] font-medium backdrop-blur-md"
                        style={{
                          background: preset.tokens.panelBg,
                          color: preset.tokens.textPrimary,
                          border: `1px solid ${preset.tokens.panelBorder}`,
                        }}
                      >
                        {preset.tokens.isDark ? 'Dark Glass' : 'Light Mica'}
                      </span>
                      <span
                        className="w-4 h-4 rounded-full border border-white/40"
                        style={{ background: preset.tokens.accentColor }}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-sm font-semibold">{preset.name}</span>
                      {selected && <Check className="w-4 h-4 text-[var(--pebble-accent)] shrink-0" />}
                    </div>
                    <p className="text-[11px] text-[var(--pebble-text-secondary)] line-clamp-2">
                      {preset.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Animated Background & Custom Wallpaper + Specialized Theme AI */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <section className="lg:col-span-5 rounded-2xl pebble-glass p-6 space-y-4">
              <h2 className="font-display text-base font-semibold">
                Background Motion &amp; Atmosphere
              </h2>
              <p className="text-xs text-[var(--pebble-text-secondary)]">
                Add subtle motion behind frosted glass panels.
              </p>

              <div className="space-y-2">
                {ANIMATION_OPTIONS.map((anim) => {
                  const active = settings.backgroundAnimation === anim.id;
                  return (
                    <button
                      key={anim.id}
                      type="button"
                      onClick={() => void onUpdateSettings({ backgroundAnimation: anim.id })}
                      className={`w-full flex items-center justify-between gap-3 p-3 rounded-xl border text-left transition-colors ${
                        active
                          ? 'border-[var(--pebble-accent)] bg-emerald-700/15'
                          : 'pebble-glass-subtle hover:opacity-90'
                      }`}
                    >
                      <div>
                        <div className="text-xs font-semibold">{anim.label}</div>
                        <div className="text-[11px] text-[var(--pebble-text-secondary)]">
                          {anim.desc}
                        </div>
                      </div>
                      {active && <Check className="w-4 h-4 text-[var(--pebble-accent)] shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="lg:col-span-7 rounded-2xl pebble-glass p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-base font-semibold flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-[var(--pebble-accent)]" />
                    <span>Custom Background &amp; Specialized AI UI Theme Editor</span>
                  </h2>
                  <p className="text-xs text-[var(--pebble-text-secondary)] mt-0.5">
                    Upload any wallpaper and Pebble&apos;s Theme AI automatically adapts panel translucency, contrast, text legibility, accents, and animation to harmonize the entire app.
                  </p>
                </div>
              </div>

              <input
                ref={bgUploadRef}
                type="file"
                accept="image/*"
                onChange={handleBackgroundFileUpload}
                className="hidden"
              />

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={adaptingBg}
                  onClick={() => bgUploadRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl pebble-accent-btn text-xs font-semibold whitespace-nowrap"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{adaptingBg ? 'Adapting UI...' : 'Upload Background & Restyle UI'}</span>
                </button>

                {settings.customBackgroundUrl && (
                  <>
                    <button
                      type="button"
                      disabled={adaptingBg}
                      onClick={() => void runAiBackgroundAdaptation()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl pebble-glass-subtle text-xs font-medium hover:opacity-85 whitespace-nowrap"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-[var(--pebble-accent)]" />
                      <span>{adaptingBg ? 'Restyling...' : 'Re-Run Theme AI'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleClearCustomBackground()}
                      className="px-3.5 py-2.5 rounded-xl pebble-glass-subtle text-xs hover:text-red-500 whitespace-nowrap"
                    >
                      Reset Background
                    </button>
                  </>
                )}

                <label className="inline-flex items-center gap-1.5 text-xs text-[var(--pebble-text-secondary)] cursor-pointer ml-auto">
                  <input
                    type="checkbox"
                    checked={preferLightAdapt}
                    onChange={(e) => setPreferLightAdapt(e.target.checked)}
                    className="accent-emerald-700"
                  />
                  <span>Prefer Light Glass</span>
                </label>
              </div>

              {bgError && (
                <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/15 text-xs text-red-700 dark:text-red-300">
                  {bgError}
                </div>
              )}

              {bgRationale && (
                <div className="p-3 rounded-xl border border-emerald-600/30 bg-emerald-700/15 text-xs text-emerald-800 dark:text-emerald-200">
                  {bgRationale}
                </div>
              )}

              {settings.customBackgroundUrl ? (
                <div className="rounded-xl overflow-hidden border border-[var(--pebble-panel-border)] relative h-44">
                  <img
                    src={settings.customBackgroundUrl}
                    alt="Uploaded custom wallpaper background"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent flex items-end p-3">
                    <span className="text-xs font-mono text-white">
                      Active Wallpaper · {settings.aiCustomTheme ? `AI Glass (${settings.aiCustomTheme.accentColor})` : 'Custom Backdrop'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="h-36 rounded-xl border border-dashed border-[var(--pebble-panel-border)] flex flex-col items-center justify-center text-xs text-[var(--pebble-text-secondary)]">
                  No custom wallpaper uploaded — using preset theme backdrop.
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* EMBEDDED MODELS SUB-TAB */}
      {subTab === 'models' && (
        <ModelsView
          models={models}
          hardware={hardware}
          embedded
          builtInOnly={!settings.developerMode}
          onStateRefresh={onStateRefresh}
        />
      )}

      {/* EMBEDDED ROUTERS SUB-TAB */}
      {subTab === 'routers' && (
        <RoutersView
          settings={settings}
          hardware={hardware}
          models={models}
          queue={queue}
          routingHistory={routingHistory}
          memoryHistory={memoryHistory}
          embedded
          onStateRefresh={onStateRefresh}
        />
      )}

      {/* EMBEDDED REMOTE ACCESS SUB-TAB */}
      {subTab === 'remote' && (
        <RemoteView
          settings={settings}
          remoteDevices={remoteDevices}
          queue={queue}
          embedded
          onUpdateSettings={onUpdateSettings}
          onStateRefresh={onStateRefresh}
        />
      )}

      {/* GENERAL, DEVELOPER MODE & SYSTEM DIAGNOSTICS */}
      {subTab === 'general' && (
        <div className="space-y-6">
          {/* Developer Mode Master Toggle Card */}
          <section className="rounded-2xl pebble-glass p-6 flex flex-wrap items-center justify-between gap-4 border border-[var(--pebble-panel-border)]">
            <div className="max-w-2xl space-y-1">
              <div className="flex items-center gap-2 font-display text-base font-semibold">
                <Code2 className="w-4 h-4 text-[var(--pebble-accent)]" />
                <span>Developer Mode</span>
                <span className="text-[11px] font-mono text-[var(--pebble-accent)]">
                  ({settings.developerMode ? 'Enabled' : 'Off by Default'})
                </span>
              </div>
              <p className="text-xs text-[var(--pebble-text-secondary)] leading-relaxed">
                When Developer Mode is OFF, Pebble AI uses a clean consumer layout: Home, Chat (with built-in Voice Mode &amp; draft image generation), Image Lab, Agent, and Settings. Turn Developer Mode ON to break Voice, Hugging Face Hub Model Browser, Quantization, Routers, and Remote Access into separate sidebar workspaces plus local Windows worker diagnostics.
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={settings.developerMode}
              onClick={() => void onUpdateSettings({ developerMode: !settings.developerMode })}
              className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                settings.developerMode
                  ? 'pebble-accent-btn'
                  : 'pebble-glass-subtle hover:opacity-85'
              }`}
            >
              {settings.developerMode ? 'Developer Mode: ON' : 'Enable Developer Mode'}
            </button>
          </section>

          <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Memory, Routers & Preferences */}
            <div className="rounded-2xl pebble-glass p-6 space-y-4">
              <h2 className="font-display text-sm font-semibold">
                Memory, Routers &amp; Quantization
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label htmlFor="settings-router" className="block text-[var(--pebble-text-secondary)] mb-1">
                    Active Model Router
                  </label>
                  <select
                    id="settings-router"
                    value={draft.activeRouterId}
                    onChange={(e) => setDraft({ ...draft, activeRouterId: e.target.value as RouterId })}
                    className="w-full px-3 py-2 rounded-lg pebble-glass-subtle font-medium"
                  >
                    {ROUTER_PROFILES.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="settings-quant" className="block text-[var(--pebble-text-secondary)] mb-1">
                    Preferred Quantization
                  </label>
                  <select
                    id="settings-quant"
                    value={draft.preferredQuantization}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        preferredQuantization: e.target.value as PebbleSettings['preferredQuantization'],
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg pebble-glass-subtle font-mono"
                  >
                    <option value="auto">Auto (4GB Optimal)</option>
                    <option value="Q4_K_M">GGUF Q4_K_M</option>
                    <option value="AWQ">AWQ 4-bit</option>
                    <option value="GPTQ">GPTQ 4-bit</option>
                    <option value="BNB_NF4">bitsandbytes NF4</option>
                  </select>
                </div>
              </div>

              <label className="flex items-center justify-between text-xs cursor-pointer">
                <span className="text-[var(--pebble-text-secondary)]">
                  Allow Uncensored Pebble Chat &amp; Image Models (Never granted PC mouse/keyboard access)
                </span>
                <input
                  type="checkbox"
                  checked={draft.allowUncensoredModels}
                  onChange={(e) => setDraft({ ...draft, allowUncensoredModels: e.target.checked })}
                  className="accent-emerald-700"
                />
              </label>

              <label className="flex items-center justify-between text-xs cursor-pointer">
                <span className="text-[var(--pebble-text-secondary)]">
                  Smart Resource Mode (Single Heavy GPU Workload + Layer Offload)
                </span>
                <input
                  type="checkbox"
                  checked={draft.smartResourceMode}
                  onChange={(e) => setDraft({ ...draft, smartResourceMode: e.target.checked })}
                  className="accent-emerald-700"
                />
              </label>

              <label className="flex items-center justify-between text-xs cursor-pointer">
                <span className="text-[var(--pebble-text-secondary)]">
                  Image Lab Low-VRAM Sequential Offload &amp; VAE Tiling
                </span>
                <input
                  type="checkbox"
                  checked={draft.qwenLowVramEnabled}
                  onChange={(e) => setDraft({ ...draft, qwenLowVramEnabled: e.target.checked })}
                  className="accent-emerald-700"
                />
              </label>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="idle-timeout" className="block text-xs text-[var(--pebble-text-secondary)] mb-1">
                    Idle Unload (s)
                  </label>
                  <input
                    id="idle-timeout"
                    type="number"
                    min={30}
                    max={3600}
                    value={draft.idleUnloadSeconds}
                    onChange={(e) => setDraft({ ...draft, idleUnloadSeconds: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg pebble-glass-subtle text-xs font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="vram-cap" className="block text-xs text-[var(--pebble-text-secondary)] mb-1">
                    VRAM Cap (GB)
                  </label>
                  <input
                    id="vram-cap"
                    type="number"
                    step="0.2"
                    min={1}
                    max={24}
                    value={draft.maxVramBudgetGb}
                    onChange={(e) => setDraft({ ...draft, maxVramBudgetGb: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg pebble-glass-subtle text-xs font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="ram-cap" className="block text-xs text-[var(--pebble-text-secondary)] mb-1">
                    RAM Cap (GB)
                  </label>
                  <input
                    id="ram-cap"
                    type="number"
                    min={4}
                    max={128}
                    value={draft.maxRamBudgetGb}
                    onChange={(e) => setDraft({ ...draft, maxRamBudgetGb: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg pebble-glass-subtle text-xs font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Worker Endpoints + Save */}
            <div className="rounded-2xl pebble-glass p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-sm font-semibold">
                  Local Windows 11 Inference &amp; PC Control Workers
                </h2>
                <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.localWorkers.preferLocalWorkers}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        localWorkers: {
                          ...draft.localWorkers,
                          preferLocalWorkers: e.target.checked,
                        },
                      })
                    }
                    className="accent-emerald-700"
                  />
                  <span>Prefer Local</span>
                </label>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label htmlFor="ollama-url" className="block text-[var(--pebble-text-secondary)] mb-1">
                    Ollama / llama.cpp Endpoint ({hardware.activeWorkers.ollama ? 'Online' : 'Offline'})
                  </label>
                  <input
                    id="ollama-url"
                    type="url"
                    value={draft.localWorkers.ollamaUrl}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        localWorkers: { ...draft.localWorkers, ollamaUrl: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg pebble-glass-subtle font-mono"
                  />
                </div>

                <div>
                  <label htmlFor="qwen-worker-url" className="block text-[var(--pebble-text-secondary)] mb-1">
                    Image Lab Worker ({hardware.activeWorkers.qwenImage ? 'Online' : 'Offline'})
                  </label>
                  <input
                    id="qwen-worker-url"
                    type="url"
                    value={draft.localWorkers.qwenImageUrl}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        localWorkers: { ...draft.localWorkers, qwenImageUrl: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg pebble-glass-subtle font-mono"
                  />
                </div>

                <div>
                  <label htmlFor="pc-worker-url" className="block text-[var(--pebble-text-secondary)] mb-1">
                    Win32 PC Mouse &amp; Keyboard Worker (Censored Models Only)
                  </label>
                  <input
                    id="pc-worker-url"
                    type="url"
                    value={draft.localWorkers.pcControlWorkerUrl || 'http://127.0.0.1:7863'}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        localWorkers: { ...draft.localWorkers, pcControlWorkerUrl: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg pebble-glass-subtle font-mono"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => onUpdateSettings({ setupCompleted: false })}
                  className="inline-flex items-center gap-1.5 text-xs text-[var(--pebble-text-secondary)] hover:text-[var(--pebble-text-primary)]"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Re-run Setup Wizard</span>
                </button>

                <button
                  type="submit"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl pebble-accent-btn text-xs font-semibold whitespace-nowrap"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{savedNotice ? 'Saved' : 'Save Settings'}</span>
                </button>
              </div>
            </div>
          </form>

          {/* Developer Diagnostics & Windows Installer (expanded when Developer Mode is ON) */}
          {settings.developerMode && (
            <div className="rounded-2xl pebble-glass p-6 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-base font-semibold flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-[var(--pebble-accent)]" />
                    <span>Windows 11 Desktop Installer, Diagnostics &amp; Worker Scripts</span>
                  </h2>
                  <p className="text-xs text-[var(--pebble-text-secondary)] mt-1">
                    AMD Preferred Backend: {hardware.amdAcceleration.preferredBackend.replace(/_/g, ' ')} · Export diagnostics or download local Python workers including <span className="font-mono">pc_control_worker.py</span>.
                  </p>
                </div>
                <a
                  href="/api/diagnostics/export"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl pebble-glass-subtle hover:opacity-85 text-xs font-medium whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export Diagnostics JSON</span>
                </a>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {windowsFiles.map((f) => (
                  <a
                    key={f.key}
                    href={`/api/windows/download/${encodeURIComponent(f.key)}`}
                    className="flex items-center justify-between gap-2 p-3 rounded-xl pebble-glass-subtle hover:border-[var(--pebble-accent)] transition-colors text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileCode className="w-4 h-4 text-[var(--pebble-accent)] shrink-0" />
                      <div className="min-w-0">
                        <div className="font-mono truncate">{f.key}</div>
                        <div className="text-[11px] text-[var(--pebble-text-secondary)] tabular-nums">
                          {(f.sizeBytes / 1024).toFixed(1)} KB
                        </div>
                      </div>
                    </div>
                    <Download className="w-3.5 h-3.5 text-[var(--pebble-text-secondary)] shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
