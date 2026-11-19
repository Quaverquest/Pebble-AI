import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FolderPlus,
  HardDrive,
  Lock,
  PlusCircle,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  CompatibilityReport,
  HardwareSpecs,
  ModelEntry,
  ModelTaskProfile,
} from '../core/types';

interface ModelsViewProps {
  models: ModelEntry[];
  hardware: HardwareSpecs;
  embedded?: boolean;
  builtInOnly?: boolean;
  onStateRefresh: () => Promise<void>;
}

interface DiscoveredHfModel {
  repoId: string;
  name: string;
  family: string;
  downloads: number;
  likes: number;
  pipelineTag: string;
  parametersBillion: number;
  quantization: string;
  censorship: 'censored' | 'uncensored';
  supportedTasks: ModelTaskProfile[];
  compatibility: CompatibilityReport;
}

type RegistryFilter =
  | 'all'
  | 'pebble'
  | 'chat'
  | 'image'
  | 'censored'
  | 'uncensored'
  | 'voice_vision';

const QUANT_OPTIONS = ['Q4_K_M', 'AWQ', 'GPTQ', 'BNB_NF4', 'INT8_OFFLOAD', 'Q8_0', 'FP16'];

const TASK_PROFILE_LABELS: Array<{ id: ModelTaskProfile; label: string }> = [
  { id: 'general_chat', label: 'Chat' },
  { id: 'coding', label: 'Coding' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'vision', label: 'Vision' },
  { id: 'image_generation', label: 'Image Gen' },
  { id: 'image_editing', label: 'Image Edit' },
  { id: 'speech_recognition', label: 'Speech ASR' },
  { id: 'speech_generation', label: 'Speech TTS' },
  { id: 'omni_routing', label: 'Omni Router' },
];

export const ModelsView: React.FC<ModelsViewProps> = ({
  models,
  hardware,
  embedded = false,
  builtInOnly = false,
  onStateRefresh,
}) => {
  const [tab, setTab] = useState<'installed' | 'discover' | 'import'>('installed');
  const [filter, setFilter] = useState<RegistryFilter>('all');
  const [registrySearch, setRegistrySearch] = useState('');

  // Hugging Face Full Hub Browser state (Developer Mode)
  const [hfQuery, setHfQuery] = useState('');
  const [hfPipeline, setHfPipeline] = useState('all');
  const [hfQuant, setHfQuant] = useState('all');
  const [hfSort, setHfSort] = useState('downloads');
  const [hfPage, setHfPage] = useState(0);
  const [hfHasMore, setHfHasMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredHfModel[]>([]);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [addingRepo, setAddingRepo] = useState<string | null>(null);

  // Import local model state (Developer Mode)
  const [localName, setLocalName] = useState('');
  const [localRepoId, setLocalRepoId] = useState('');
  const [localPath, setLocalPath] = useState(
    'C:\\Users\\Owner\\AppData\\Local\\PebbleAI\\models\\custom.gguf'
  );
  const [localParams, setLocalParams] = useState(7);
  const [localQuant, setLocalQuant] = useState('Q4_K_M');

  const fetchHuggingFaceHub = async (pageOverride = hfPage) => {
    setSearching(true);
    setDiscoverError(null);
    try {
      const qs = new URLSearchParams({
        q: hfQuery.trim(),
        pipeline: hfPipeline,
        quant: hfQuant,
        sort: hfSort,
        page: String(pageOverride),
        limit: '24',
      });
      const res = await fetch(`/api/models/discover?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Hugging Face query failed');
      setDiscovered(data.results ?? []);
      setHfHasMore(Boolean(data.hasMore));
    } catch (err) {
      setDiscoverError((err as Error).message);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (!builtInOnly && tab === 'discover' && discovered.length === 0 && !searching) {
      void fetchHuggingFaceHub(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, builtInOnly]);

  const handleAddModel = async (item: DiscoveredHfModel) => {
    setAddingRepo(item.repoId);
    try {
      await fetch('/api/models/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoId: item.repoId,
          name: item.name,
          family: item.family,
          parametersBillion: item.parametersBillion,
          quantization: item.quantization,
          censorship: item.censorship,
          supportedTasks: item.supportedTasks,
          instantReady: true,
        }),
      });
      setTab('installed');
      await onStateRefresh();
    } finally {
      setAddingRepo(null);
    }
  };

  const handleQuantChange = async (modelId: string, quantization: string) => {
    await fetch('/api/models/quantize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId, quantization }),
    });
    await onStateRefresh();
  };

  const handleLoadNow = async (modelId: string) => {
    await fetch('/api/models/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId }),
    });
    await onStateRefresh();
  };

  const handleRemoveModel = async (id: string) => {
    await fetch(`/api/models/${id}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete' }),
    });
    await onStateRefresh();
  };

  const handleToggleProfile = async (
    modelId: string,
    profile: ModelTaskProfile,
    enabled: boolean
  ) => {
    await fetch('/api/models/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId, profile, enabled }),
    });
    await onStateRefresh();
  };

  const handleImportLocal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!localName.trim() || !localPath.trim()) return;
    await fetch('/api/models/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoId:
          localRepoId.trim() || `local/${localName.trim().toLowerCase().replace(/\s+/g, '-')}`,
        name: localName.trim(),
        family: 'Local Import',
        parametersBillion: localParams,
        quantization: localQuant,
        supportedTasks: ['general_chat', 'coding'],
        localPath: localPath.trim(),
        instantReady: true,
      }),
    });
    setLocalName('');
    setLocalRepoId('');
    setTab('installed');
    await onStateRefresh();
  };

  const scopedModels = builtInOnly
    ? models.filter((m) => Boolean(m.isPebbleModel || m.isPrimaryImageModel))
    : models;

  const bestMatches = scopedModels.filter((m) => m.compatibility.isSystemBestMatch);

  const visibleModels = scopedModels.filter((m) => {
    if (registrySearch.trim()) {
      const q = registrySearch.toLowerCase();
      if (
        !m.name.toLowerCase().includes(q) &&
        !m.repoId.toLowerCase().includes(q) &&
        !(m.baseModelRepo || '').toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    switch (filter) {
      case 'pebble':
        return Boolean(m.isPebbleModel);
      case 'chat':
        return m.supportedTasks.some((t) => ['general_chat', 'coding', 'reasoning'].includes(t));
      case 'image':
        return m.supportedTasks.some((t) => ['image_generation', 'image_editing'].includes(t));
      case 'censored':
        return m.censorship !== 'uncensored';
      case 'uncensored':
        return m.censorship === 'uncensored';
      case 'voice_vision':
        return m.supportedTasks.some((t) =>
          ['speech_recognition', 'speech_generation', 'vision'].includes(t)
        );
      default:
        return true;
    }
  });

  const activeTab = builtInOnly ? 'installed' : tab;

  return (
    <div className={embedded ? 'space-y-6' : 'max-w-[1320px] mx-auto px-6 py-6 space-y-6'}>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--pebble-panel-border)] pb-4">
        <div>
          <h2 className={`font-display font-semibold ${embedded ? 'text-xl' : 'text-2xl'}`}>
            {builtInOnly ? 'Built-in Pebble AI Models' : 'Model Library & Full Hugging Face Browser'}
          </h2>
          <p className="text-xs text-[var(--pebble-text-secondary)] mt-1 tabular-nums">
            {builtInOnly
              ? 'Built-in Pebble Chat & Image models (Tiny, Small, Normal, Ultra) in Standard and Uncensored variants — zero downloads required. Enable Developer Mode for Hugging Face Hub.'
              : `Host: ${hardware.totalRamGb} GB RAM · ${hardware.isGpuAccelerated ? `${hardware.gpuVramGb} GB VRAM (${hardware.gpuName})` : 'CPU / Gateway Runtime'} · ${hardware.amdAcceleration.preferredBackend}`}
          </p>
        </div>

        {!builtInOnly && (
          <div className="flex items-center gap-1 p-1 rounded-xl pebble-glass-subtle">
            {(
              [
                { id: 'installed', label: `Pebble & Library (${scopedModels.length})` },
                { id: 'discover', label: 'Browse Hugging Face' },
                { id: 'import', label: 'Import Local File' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${
                  activeTab === t.id
                    ? 'pebble-accent-btn shadow-sm'
                    : 'text-[var(--pebble-text-secondary)] hover:text-[var(--pebble-text-primary)]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* REGISTRY TAB */}
      {activeTab === 'installed' && (
        <div className="space-y-5">
          {/* Auto-Detected System Best Match Recommendation Panel */}
          {bestMatches.length > 0 && (
            <section className="rounded-2xl border border-emerald-600/35 bg-emerald-700/12 p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Sparkles className="w-4 h-4 text-emerald-500" />
                  <span>Auto-Detected Best Matches for Your System</span>
                </div>
                <span className="text-xs font-mono text-[var(--pebble-accent)]">
                  {hardware.amdAcceleration.preferredBackend}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {bestMatches.map((bm) => (
                  <div
                    key={bm.id}
                    className="rounded-xl pebble-glass p-4 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="text-[11px] font-mono text-[var(--pebble-accent)]">
                        {bm.compatibility.bestMatchLabel} · Fit {bm.compatibility.systemFitScore}/100
                      </div>
                      <div className="font-display text-sm font-semibold truncate">
                        {bm.name}
                      </div>
                      <div className="text-xs font-mono text-[var(--pebble-text-secondary)] tabular-nums">
                        {bm.quantization} · {bm.compatibility.gpuLayersOffloaded}/{bm.compatibility.totalLayers} GPU layers · {bm.compatibility.estimatedRamGb}G RAM
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleLoadNow(bm.id)}
                      className="px-3 py-1.5 rounded-lg pebble-accent-btn text-xs font-semibold shrink-0 whitespace-nowrap"
                    >
                      Load Now
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Filter & Search Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl pebble-glass-subtle">
              {(
                (builtInOnly
                  ? [
                      { id: 'all', label: 'All Built-in' },
                      { id: 'chat', label: 'Chat' },
                      { id: 'image', label: 'Image' },
                      { id: 'censored', label: 'Standard (PC Control)' },
                      { id: 'uncensored', label: 'Uncensored (No PC)' },
                    ]
                  : [
                      { id: 'all', label: 'All' },
                      { id: 'pebble', label: 'Pebble AI Suite' },
                      { id: 'chat', label: 'Chat' },
                      { id: 'image', label: 'Image' },
                      { id: 'censored', label: 'Standard' },
                      { id: 'uncensored', label: 'Uncensored' },
                      { id: 'voice_vision', label: 'Voice & Vision' },
                    ]) as ReadonlyArray<{ id: RegistryFilter; label: string }>
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${
                    filter === f.id
                      ? 'pebble-accent-btn shadow-sm'
                      : 'text-[var(--pebble-text-secondary)]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-[var(--pebble-text-secondary)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={registrySearch}
                onChange={(e) => setRegistrySearch(e.target.value)}
                placeholder="Filter models..."
                aria-label="Filter model registry"
                className="w-full pl-8 pr-3 py-1.5 rounded-xl pebble-glass-subtle text-xs"
              />
            </div>
          </div>

          {/* Model Registry Cards */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {visibleModels.map((m) => (
              <div
                key={m.id}
                className="rounded-2xl pebble-glass p-5 space-y-3.5 flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-[var(--pebble-text-secondary)] tabular-nums">
                    <span className="inline-flex items-center gap-1.5">
                      {m.censorship === 'uncensored' ? (
                        <Lock className="w-3.5 h-3.5 text-amber-500" />
                      ) : (
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                      )}
                      <span>
                        {m.tier ? `${m.tier.toUpperCase()} · ` : ''}
                        {m.censorship === 'uncensored' ? 'Uncensored (No PC Access)' : 'Standard (PC Capable)'} · {m.parametersBillion}B
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1 text-[var(--pebble-accent)]">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Ready</span>
                    </span>
                  </div>

                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-display text-base font-semibold">
                        {m.name}
                      </h3>
                      <div className="text-[11px] font-mono text-[var(--pebble-text-secondary)] truncate mt-0.5">
                        {m.repoId}
                        {m.baseModelRepo ? ` · Edited from ${m.baseModelRepo}` : ''}
                      </div>
                    </div>

                    {!builtInOnly && (
                      <select
                        aria-label={`Quantization format for ${m.name}`}
                        value={m.quantization}
                        onChange={(e) => void handleQuantChange(m.id, e.target.value)}
                        className="px-2.5 py-1 rounded-lg pebble-glass-subtle text-[11px] font-mono shrink-0"
                      >
                        {!QUANT_OPTIONS.includes(m.quantization) && (
                          <option value={m.quantization}>{m.quantization}</option>
                        )}
                        {QUANT_OPTIONS.map((q) => (
                          <option key={q} value={q}>
                            {q}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <p className="text-xs text-[var(--pebble-text-secondary)] leading-relaxed">
                    {m.description}
                  </p>

                  <div className="text-xs font-mono text-[var(--pebble-text-secondary)] tabular-nums flex flex-wrap items-center gap-x-2">
                    <span
                      className={
                        m.compatibility.tier === 'Recommended'
                          ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                          : m.compatibility.tier === 'Compatible with limitations'
                            ? 'text-amber-600 dark:text-amber-400 font-semibold'
                            : 'text-red-500 font-semibold'
                      }
                    >
                      {m.compatibility.tier}
                    </span>
                    <span>·</span>
                    <span>Fit {m.compatibility.systemFitScore}/100</span>
                    <span>·</span>
                    <span>
                      Est. {m.compatibility.estimatedVramGb}G VRAM / {m.compatibility.estimatedRamGb}G RAM
                    </span>
                  </div>
                </div>

                <div className="pt-3 border-t border-[var(--pebble-panel-border)] flex flex-wrap items-center justify-between gap-3">
                  {!builtInOnly ? (
                    <div className="flex flex-wrap items-center gap-2.5 text-xs">
                      {TASK_PROFILE_LABELS.filter(
                        (p) => m.supportedTasks.includes(p.id) || p.id === 'omni_routing'
                      ).map((p) => (
                        <label
                          key={p.id}
                          className="inline-flex items-center gap-1 text-[var(--pebble-text-secondary)] cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={m.assignedProfiles.includes(p.id)}
                            onChange={(e) =>
                              void handleToggleProfile(m.id, p.id, e.target.checked)
                            }
                            className="accent-emerald-700"
                          />
                          <span>{p.label}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[11px] font-mono text-[var(--pebble-text-secondary)]">
                      {m.compatibility.recommendedBackend}
                    </span>
                  )}

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleLoadNow(m.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg pebble-accent-btn text-xs font-medium"
                    >
                      <Cpu className="w-3 h-3" />
                      <span>Mount / Load</span>
                    </button>
                    {!builtInOnly && !m.isPebbleModel && !m.isPrimaryImageModel && (
                      <button
                        type="button"
                        onClick={() => void handleRemoveModel(m.id)}
                        className="p-1.5 rounded-lg pebble-glass-subtle hover:text-red-500"
                        aria-label={`Remove ${m.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FULL HUGGING FACE HUB BROWSER (Developer Mode) */}
      {activeTab === 'discover' && (
        <div className="space-y-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setHfPage(0);
              void fetchHuggingFaceHub(0);
            }}
            className="grid grid-cols-1 md:grid-cols-12 gap-2.5"
          >
            <div className="md:col-span-5 relative">
              <Search className="w-4 h-4 text-[var(--pebble-text-secondary)] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={hfQuery}
                onChange={(e) => setHfQuery(e.target.value)}
                placeholder="Browse Hugging Face Hub (Llama, Qwen, Flux, Mistral, GGUF)..."
                aria-label="Search all Hugging Face Hub models"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl pebble-glass-subtle text-xs"
              />
            </div>

            <select
              aria-label="Filter by Hugging Face pipeline task"
              value={hfPipeline}
              onChange={(e) => setHfPipeline(e.target.value)}
              className="md:col-span-2 px-3 py-2.5 rounded-xl pebble-glass-subtle text-xs"
            >
              <option value="all">All Tasks</option>
              <option value="text-generation">Text Generation</option>
              <option value="text-to-image">Text to Image</option>
              <option value="image-to-image">Image Editing</option>
              <option value="image-text-to-text">Vision-Language</option>
              <option value="automatic-speech-recognition">Speech ASR</option>
              <option value="text-to-speech">Text to Speech</option>
            </select>

            <select
              aria-label="Filter by Hugging Face quantization format"
              value={hfQuant}
              onChange={(e) => setHfQuant(e.target.value)}
              className="md:col-span-2 px-3 py-2.5 rounded-xl pebble-glass-subtle text-xs"
            >
              <option value="all">All Formats</option>
              <option value="gguf">GGUF (Vulkan)</option>
              <option value="awq">AWQ 4-bit</option>
              <option value="gptq">GPTQ 4-bit</option>
              <option value="bnb">bitsandbytes NF4</option>
              <option value="diffusers">Diffusers (Image)</option>
            </select>

            <select
              aria-label="Sort Hugging Face results"
              value={hfSort}
              onChange={(e) => setHfSort(e.target.value)}
              className="md:col-span-2 px-3 py-2.5 rounded-xl pebble-glass-subtle text-xs"
            >
              <option value="downloads">Sort: Downloads</option>
              <option value="likes">Sort: Likes</option>
              <option value="lastModified">Sort: Updated</option>
            </select>

            <button
              type="submit"
              disabled={searching}
              className="md:col-span-1 px-4 py-2.5 rounded-xl pebble-accent-btn disabled:opacity-50 text-xs font-semibold whitespace-nowrap"
            >
              {searching ? '...' : 'Browse'}
            </button>
          </form>

          {discoverError && (
            <div className="p-3.5 rounded-xl border border-red-500/30 bg-red-500/15 text-xs text-red-700 dark:text-red-300">
              {discoverError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {discovered.map((item) => {
              const alreadyAdded = models.some((m) => m.repoId === item.repoId);
              return (
                <div
                  key={item.repoId}
                  className="rounded-2xl pebble-glass p-4 space-y-3 flex flex-col justify-between"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-[var(--pebble-text-secondary)]">
                      <span className="truncate">
                        {item.pipelineTag} · {item.parametersBillion}B · {item.quantization}
                      </span>
                      <span className="tabular-nums shrink-0">{item.downloads.toLocaleString()} dl</span>
                    </div>
                    <h3 className="font-display text-sm font-semibold break-all">
                      {item.repoId}
                    </h3>
                    <div className="text-xs font-mono tabular-nums">
                      <span
                        className={
                          item.compatibility.tier === 'Recommended'
                            ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                            : item.compatibility.tier === 'Compatible with limitations'
                              ? 'text-amber-600 dark:text-amber-400 font-semibold'
                              : 'text-red-500 font-semibold'
                        }
                      >
                        {item.compatibility.tier}
                      </span>
                      <span className="text-[var(--pebble-text-secondary)] ml-2">
                        Fit {item.compatibility.systemFitScore}/100 · {item.compatibility.estimatedRamGb}G RAM
                      </span>
                    </div>
                    <p className="text-xs text-[var(--pebble-text-secondary)] line-clamp-2">
                      {item.compatibility.reasons[0]}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={alreadyAdded || addingRepo === item.repoId}
                    onClick={() => void handleAddModel(item)}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl pebble-accent-btn disabled:opacity-45 text-xs font-semibold whitespace-nowrap"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>
                      {alreadyAdded
                        ? 'Mounted in Library'
                        : addingRepo === item.repoId
                          ? 'Mounting...'
                          : 'Add Instant (No Download)'}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>

          {discovered.length > 0 && (
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                disabled={hfPage === 0 || searching}
                onClick={() => {
                  const prev = Math.max(0, hfPage - 1);
                  setHfPage(prev);
                  void fetchHuggingFaceHub(prev);
                }}
                className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl pebble-glass-subtle text-xs disabled:opacity-40"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Previous Page</span>
              </button>
              <span className="text-xs font-mono text-[var(--pebble-text-secondary)] tabular-nums">
                Page {hfPage + 1} · {discovered.length} models shown
              </span>
              <button
                type="button"
                disabled={!hfHasMore || searching}
                onClick={() => {
                  const next = hfPage + 1;
                  setHfPage(next);
                  void fetchHuggingFaceHub(next);
                }}
                className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl pebble-glass-subtle text-xs disabled:opacity-40"
              >
                <span>Next Page</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* IMPORT LOCAL MODEL (Developer Mode) */}
      {activeTab === 'import' && (
        <form
          onSubmit={handleImportLocal}
          className="max-w-xl rounded-2xl pebble-glass p-6 space-y-4"
        >
          <div className="flex items-center gap-2 text-sm font-semibold">
            <HardDrive className="w-4 h-4 text-[var(--pebble-accent)]" />
            <span>Register Existing Local Weights (GGUF / AWQ / GPTQ / Safetensors)</span>
          </div>

          <div>
            <label htmlFor="local-model-name" className="block text-xs text-[var(--pebble-text-secondary)] mb-1">
              Display Name
            </label>
            <input
              id="local-model-name"
              type="text"
              required
              value={localName}
              onChange={(e) => setLocalName(e.target.value)}
              placeholder="e.g. Mistral 7B Instruct AWQ"
              className="w-full px-3.5 py-2 rounded-xl pebble-glass-subtle text-sm"
            />
          </div>

          <div>
            <label htmlFor="local-model-path" className="block text-xs text-[var(--pebble-text-secondary)] mb-1">
              Local File or Directory Path
            </label>
            <input
              id="local-model-path"
              type="text"
              required
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl pebble-glass-subtle text-xs font-mono"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="local-params" className="block text-xs text-[var(--pebble-text-secondary)] mb-1">
                Parameters (Billions)
              </label>
              <input
                id="local-params"
                type="number"
                step="0.1"
                value={localParams}
                onChange={(e) => setLocalParams(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl pebble-glass-subtle text-xs font-mono"
              />
            </div>
            <div>
              <label htmlFor="local-quant" className="block text-xs text-[var(--pebble-text-secondary)] mb-1">
                Quantization
              </label>
              <select
                id="local-quant"
                value={localQuant}
                onChange={(e) => setLocalQuant(e.target.value)}
                className="w-full px-3 py-2 rounded-xl pebble-glass-subtle text-xs font-mono"
              >
                {QUANT_OPTIONS.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="submit"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl pebble-accent-btn text-xs font-semibold whitespace-nowrap"
          >
            <FolderPlus className="w-4 h-4" />
            <span>Import into Model Library</span>
          </button>
        </form>
      )}
    </div>
  );
};
