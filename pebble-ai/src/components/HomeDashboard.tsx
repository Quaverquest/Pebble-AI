import React, { useState } from 'react';
import {
  ArrowUpRight,
  Bot,
  Cpu,
  HardDrive,
  Image as ImageIcon,
  MessageSquare,
  Mic,
  Send,
  Wifi,
} from 'lucide-react';
import { isModelActiveInMemory } from '../core/lifecycle';
import { getRouterProfile } from '../core/omni';
import type { NavSection, PebbleStateSnapshot } from '../core/types';

interface HomeDashboardProps {
  state: PebbleStateSnapshot;
  onNavigate: (section: NavSection) => void;
  onQuickChat: (prompt: string, options?: { startVoice?: boolean }) => void;
  onQuickImage: (prompt: string) => void;
  onOpenConversation: (conversationId: string) => void;
}

function getGreeting(): string {
  const hr = new Date().getHours();
  if (hr < 12) return 'Good morning';
  if (hr < 18) return 'Good afternoon';
  return 'Good evening';
}

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  state,
  onNavigate,
  onQuickChat,
  onQuickImage,
  onOpenConversation,
}) => {
  const [quickPrompt, setQuickPrompt] = useState('');
  const [quickImagePrompt, setQuickImagePrompt] = useState('');

  const activeModels = state.models.filter((m) => isModelActiveInMemory(m));
  const recentConversations = state.conversations.slice(0, 4);
  const recentImages = state.images.slice(0, 4);
  const recentRouting = state.routingHistory.slice(0, 5);
  const primaryLan = state.hardware.networkInterfaces[0];
  const activeRouter = getRouterProfile(state.settings.activeRouterId);
  const isDevMode = state.settings.developerMode;

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickPrompt.trim()) return;
    onQuickChat(quickPrompt.trim());
    setQuickPrompt('');
  };

  const handleImageSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickImagePrompt.trim()) return;
    onQuickImage(quickImagePrompt.trim());
    setQuickImagePrompt('');
  };

  return (
    <div className="max-w-[1220px] mx-auto px-6 py-8 space-y-8">
      {/* Copilot / Acrylic Frosted Hero Composer */}
      <section className="pebble-glass rounded-3xl p-7 sm:p-9 shadow-xl space-y-6">
        <div className="max-w-2xl mx-auto text-center space-y-2">
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-neutral-950 dark:text-white text-balance">
            {getGreeting()}. What&apos;s on your mind?
          </h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            Chat with built-in Voice, render quick visual drafts or full scenes in Image Lab, or run desktop automation tasks.
          </p>
        </div>

        {/* Centered Frosted Prompt Bar */}
        <form
          onSubmit={handleChatSubmit}
          className="max-w-2xl mx-auto flex items-center gap-2 p-2 rounded-2xl border border-black/10 dark:border-white/15 bg-white/75 dark:bg-black/35 backdrop-blur-xl shadow-md"
        >
          <label htmlFor="quick-chat-input" className="sr-only">
            Message Pebble AI
          </label>
          <input
            id="quick-chat-input"
            type="text"
            value={quickPrompt}
            onChange={(e) => setQuickPrompt(e.target.value)}
            placeholder="Message Pebble AI, describe an image, or speak..."
            className="flex-1 min-w-0 px-3.5 py-2.5 bg-transparent text-sm text-neutral-950 dark:text-white placeholder:text-neutral-500 dark:placeholder:text-neutral-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => onQuickChat('', { startVoice: true })}
            aria-label="Open Voice inside Chat"
            title="Start Voice in Chat"
            className="p-2.5 rounded-xl border border-black/10 dark:border-white/15 text-neutral-700 dark:text-neutral-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0"
          >
            <Mic className="w-4 h-4" />
          </button>
          <button
            type="submit"
            className="pebble-accent-btn inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Ask</span>
          </button>
        </form>

        {/* Clean Translucent Prompt Starters */}
        <div className="max-w-2xl mx-auto flex flex-wrap items-center justify-center gap-2">
          {[
            'Make a quick sketch of a misty pine cabin',
            'Help me write a Python script for batch image resizing',
            'Summarize my recent workspace notes',
          ].map((starter) => (
            <button
              key={starter}
              type="button"
              onClick={() => onQuickChat(starter)}
              className="px-3.5 py-1.5 rounded-xl border border-black/10 dark:border-white/12 bg-white/45 dark:bg-white/[0.06] hover:bg-white/75 dark:hover:bg-white/[0.12] text-xs text-neutral-800 dark:text-neutral-200 transition-colors"
            >
              {starter}
            </button>
          ))}
        </div>
      </section>

      {/* Primary Feature Tiles */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Recent Chats */}
        <div className="lg:col-span-4 pebble-glass rounded-2xl p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-neutral-950 dark:text-white">
                Jump Back In
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('chat')}
                className="text-xs font-medium hover:underline whitespace-nowrap"
                style={{ color: 'var(--pebble-accent)' }}
              >
                Open Chat
              </button>
            </div>
            <div className="divide-y divide-black/10 dark:divide-white/[0.08]">
              {recentConversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onOpenConversation(c.id)}
                  className="w-full py-2.5 text-left hover:bg-black/5 dark:hover:bg-white/[0.06] rounded-lg px-2 -mx-2 transition-colors flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <MessageSquare className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--pebble-accent)' }} />
                    <span className="text-sm text-neutral-800 dark:text-neutral-100 truncate">
                      {c.title}
                    </span>
                  </div>
                  <span className="text-xs font-mono text-neutral-500 dark:text-neutral-400 tabular-nums shrink-0">
                    {c.messages.length}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('agent')}
            className="w-full inline-flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-black/10 dark:border-white/12 bg-white/40 dark:bg-white/[0.04] hover:bg-white/70 dark:hover:bg-white/[0.09] text-xs font-medium text-neutral-800 dark:text-neutral-100 transition-colors"
          >
            <span className="flex items-center gap-2">
              <Bot className="w-4 h-4" style={{ color: 'var(--pebble-accent)' }} />
              <span>Open Desktop Agent</span>
            </span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Quick Image Lab Launcher */}
        <div className="lg:col-span-4 pebble-glass rounded-2xl p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-neutral-950 dark:text-white">
                Image Lab
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('image')}
                className="text-xs font-medium hover:underline whitespace-nowrap"
                style={{ color: 'var(--pebble-accent)' }}
              >
                Open Lab
              </button>
            </div>
            <p className="text-xs text-neutral-600 dark:text-neutral-300">
              High-detail generation, one-click background removal, and canvas brush masking.
            </p>
          </div>

          <form onSubmit={handleImageSubmit} className="space-y-2.5">
            <label htmlFor="quick-image-input" className="sr-only">
              Quick Image Lab prompt
            </label>
            <textarea
              id="quick-image-input"
              rows={3}
              value={quickImagePrompt}
              onChange={(e) => setQuickImagePrompt(e.target.value)}
              placeholder="Describe a high-resolution scene for Image Lab..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-black/10 dark:border-white/12 bg-white/55 dark:bg-black/30 text-sm text-neutral-950 dark:text-white placeholder:text-neutral-500 focus:outline-none resize-none"
            />
            <button
              type="submit"
              className="pebble-accent-btn w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>Create in Image Lab</span>
            </button>
          </form>
        </div>

        {/* Household Remote & Workspace Quick Card */}
        <div className="lg:col-span-4 pebble-glass rounded-2xl p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-neutral-950 dark:text-white">
                Local Ecosystem
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('settings')}
                className="text-xs font-medium hover:underline whitespace-nowrap"
                style={{ color: 'var(--pebble-accent)' }}
              >
                Settings
              </button>
            </div>
            <p className="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">
              Running locally via {activeRouter.name}. Configure Themes, Animated Wallpapers, Built-in Models, and Household Wi-Fi Remote Access inside Settings.
            </p>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between p-2.5 rounded-xl border border-black/10 dark:border-white/10 bg-white/35 dark:bg-white/[0.04]">
              <span className="flex items-center gap-2 text-neutral-700 dark:text-neutral-200">
                <Wifi className="w-3.5 h-3.5" style={{ color: 'var(--pebble-accent)' }} />
                <span>Wi-Fi Remote</span>
              </span>
              <span className="font-mono text-neutral-800 dark:text-neutral-100">
                {state.settings.remoteEnabled ? 'Active' : 'Disabled'}
              </span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-xl border border-black/10 dark:border-white/10 bg-white/35 dark:bg-white/[0.04]">
              <span className="text-neutral-700 dark:text-neutral-200">Interface Mode</span>
              <span className="font-mono text-neutral-800 dark:text-neutral-100">
                {isDevMode ? 'Developer' : 'Streamlined'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Developer Telemetry Strip (Only shown when Developer Mode is ON) */}
      {isDevMode && (
        <section className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="pebble-glass rounded-xl p-4 space-y-1">
              <div className="text-xs text-neutral-500 dark:text-neutral-400 flex items-center justify-between">
                <span>Host CPU Load</span>
                <Cpu className="w-3.5 h-3.5" />
              </div>
              <div className="font-mono text-2xl font-semibold text-neutral-950 dark:text-white tabular-nums">
                {state.hardware.cpuLoadPercent}%
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                {state.hardware.cpuThreads} threads · {state.hardware.cpuModel}
              </div>
            </div>

            <div className="pebble-glass rounded-xl p-4 space-y-1">
              <div className="text-xs text-neutral-500 dark:text-neutral-400">System RAM</div>
              <div className="font-mono text-2xl font-semibold text-neutral-950 dark:text-white tabular-nums">
                {state.hardware.usedRamGb} / {state.hardware.totalRamGb} GB
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums">
                {state.hardware.freeRamGb} GB free ({state.hardware.ramUsagePercent}% used)
              </div>
            </div>

            <div className="pebble-glass rounded-xl p-4 space-y-1">
              <div className="text-xs text-neutral-500 dark:text-neutral-400">VRAM Pool</div>
              <div className="font-mono text-2xl font-semibold text-neutral-950 dark:text-white tabular-nums">
                {state.hardware.gpuVramUsedGb} / {state.hardware.isGpuAccelerated ? state.hardware.gpuVramGb : state.settings.maxVramBudgetGb} GB
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                {state.hardware.isGpuAccelerated ? state.hardware.gpuName : 'CPU / Gateway host'}
              </div>
            </div>

            <div className="pebble-glass rounded-xl p-4 space-y-1">
              <div className="text-xs text-neutral-500 dark:text-neutral-400 flex items-center justify-between">
                <span>Storage & LAN</span>
                <HardDrive className="w-3.5 h-3.5" />
              </div>
              <div className="font-mono text-2xl font-semibold text-neutral-950 dark:text-white tabular-nums">
                {state.hardware.diskFreeGb} GB
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                Free · {primaryLan ? primaryLan.url : 'LAN Ready'}
              </div>
            </div>
          </div>

          {recentRouting.length > 0 && (
            <div className="pebble-glass rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-sm font-semibold text-neutral-950 dark:text-white">
                  Recent Router Telemetry ({activeModels.length} Active)
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate('routers')}
                  className="text-xs font-medium hover:underline"
                  style={{ color: 'var(--pebble-accent)' }}
                >
                  Open Routers
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {recentRouting.slice(0, 3).map((r) => (
                  <div
                    key={r.id}
                    className="p-3 rounded-xl border border-black/10 dark:border-white/10 bg-white/30 dark:bg-black/20 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between font-medium text-neutral-900 dark:text-white">
                      <span className="truncate">{r.selectedModelName}</span>
                      <span className="font-mono text-neutral-500 tabular-nums">{r.latencyMs}ms</span>
                    </div>
                    <div className="text-neutral-500 dark:text-neutral-400 truncate">
                      {r.detectedTask.replace(/_/g, ' ')} · {r.userPromptSnippet}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Recent Image Lab Creations */}
      <section className="pebble-glass rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-neutral-950 dark:text-white">
              Recent Image Lab Creations
            </h2>
            <p className="text-xs text-neutral-600 dark:text-neutral-300">
              High-resolution gallery from Image Lab and quick Chat drafts
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('image')}
            className="px-3.5 py-2 rounded-xl border border-black/10 dark:border-white/15 text-xs font-medium text-neutral-800 dark:text-neutral-100 hover:bg-black/5 dark:hover:bg-white/[0.08] transition-colors whitespace-nowrap"
          >
            Open Image Lab
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {recentImages.map((img) => (
            <button
              key={img.id}
              type="button"
              onClick={() => onNavigate('image')}
              className="group relative aspect-[4/3] rounded-xl overflow-hidden border border-black/10 dark:border-white/12 bg-neutral-900 text-left"
            >
              <img
                src={img.imageUrl}
                alt={img.prompt}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
              />
              <div className="absolute inset-x-0 bottom-0 p-2.5 bg-gradient-to-t from-black/85 via-black/45 to-transparent">
                <div className="text-[11px] font-mono text-emerald-300 truncate">{img.modelName}</div>
                <div className="text-xs text-white line-clamp-1">{img.prompt}</div>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
};
