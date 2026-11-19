import { useCallback, useEffect, useState } from 'react';
import { AgentView } from './components/AgentView';
import { AmbientBackdrop } from './components/AmbientBackdrop';
import { ChatView } from './components/ChatView';
import { HomeDashboard } from './components/HomeDashboard';
import { ImageStudioView } from './components/ImageStudioView';
import { ModelsView } from './components/ModelsView';
import { RemoteClientApp } from './components/RemoteClientApp';
import { RemoteView } from './components/RemoteView';
import { RoutersView } from './components/RoutersView';
import { SettingsView } from './components/SettingsView';
import { SetupWizard } from './components/SetupWizard';
import { Sidebar } from './components/Sidebar';
import { VoiceView } from './components/VoiceView';
import { isModelActiveInMemory } from './core/lifecycle';
import { getRouterProfile } from './core/omni';
import { resolveActiveThemeTokens } from './core/themes';
import type { NavSection, PebbleSettings, PebbleStateSnapshot } from './core/types';

const SECTION_TITLES: Record<NavSection, string> = {
  home: 'Home',
  chat: 'Pebble Chat',
  image: 'Image Lab',
  voice: 'Voice Mode',
  agent: 'AI Agent',
  models: 'Models & Hugging Face',
  routers: 'AI Routers & Memory Offload',
  remote: 'Remote Access',
  settings: 'Settings',
};

const DEV_ONLY_SECTIONS: NavSection[] = ['voice', 'models', 'routers', 'remote'];

export default function App() {
  const isRemoteRoute =
    typeof window !== 'undefined' && window.location.pathname.startsWith('/remote');
  if (isRemoteRoute) {
    return <RemoteClientApp />;
  }

  return <DesktopEcosystem />;
}

function DesktopEcosystem() {
  const [state, setState] = useState<PebbleStateSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<NavSection>('home');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string>('conv-welcome');
  const [pendingChatPrompt, setPendingChatPrompt] = useState<string | null>(null);
  const [pendingVoiceStart, setPendingVoiceStart] = useState(false);
  const [pendingImagePrompt, setPendingImagePrompt] = useState<string | null>(null);

  const autostartSkipWizard =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('autostart') === '1';

  const refreshState = useCallback(async () => {
    const res = await fetch('/api/state');
    if (res.ok) {
      const data = (await res.json()) as PebbleStateSnapshot;
      setState(data);
      if (
        data.conversations.length > 0 &&
        !data.conversations.some((c) => c.id === activeConversationId)
      ) {
        setActiveConversationId(data.conversations[0].id);
      }
    }
    setLoading(false);
  }, [activeConversationId]);

  useEffect(() => {
    void refreshState();
    const timer = setInterval(() => {
      void refreshState();
    }, 10_000);
    return () => clearInterval(timer);
  }, [refreshState]);

  // Resolve and sync active acrylic theme tokens + dark class onto :root
  const activeThemeTokens = resolveActiveThemeTokens({
    themePreset: state?.settings.themePreset ?? 'misty_evergreen',
    customBackgroundUrl: state?.settings.customBackgroundUrl,
    aiCustomTheme: state?.settings.aiCustomTheme,
  });

  useEffect(() => {
    const root = document.documentElement;
    if (activeThemeTokens.isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    root.style.setProperty('--pebble-backdrop', activeThemeTokens.backdropGradient);
    root.style.setProperty('--pebble-panel-bg', activeThemeTokens.panelBg);
    root.style.setProperty('--pebble-panel-hover', activeThemeTokens.panelHoverBg);
    root.style.setProperty('--pebble-panel-border', activeThemeTokens.panelBorder);
    root.style.setProperty('--pebble-text-primary', activeThemeTokens.textPrimary);
    root.style.setProperty('--pebble-text-secondary', activeThemeTokens.textSecondary);
    root.style.setProperty('--pebble-accent', activeThemeTokens.accentColor);
    root.style.setProperty('--pebble-accent-hover', activeThemeTokens.accentHover);
    root.style.setProperty('--pebble-accent-text', activeThemeTokens.accentText);
    root.style.setProperty('--pebble-blur', `${activeThemeTokens.blurPx}px`);
  }, [activeThemeTokens]);

  // If Developer Mode is turned off while viewing a dev-only section, bounce safely
  useEffect(() => {
    if (state && !state.settings.developerMode && DEV_ONLY_SECTIONS.includes(activeSection)) {
      setActiveSection(activeSection === 'voice' ? 'chat' : 'settings');
    }
  }, [state, activeSection]);

  const updateSettings = async (patch: Partial<PebbleSettings>) => {
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      await refreshState();
    }
  };

  if (loading || !state) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0c1718] text-neutral-300 text-sm">
        Initializing Pebble AI...
      </div>
    );
  }

  if (!state.settings.setupCompleted && !autostartSkipWizard) {
    return (
      <>
        <AmbientBackdrop
          tokens={activeThemeTokens}
          animationStyle={state.settings.backgroundAnimation}
          customBackgroundUrl={state.settings.customBackgroundUrl}
        />
        <SetupWizard
          hardware={state.hardware}
          models={state.models}
          settings={state.settings}
          onComplete={updateSettings}
        />
      </>
    );
  }

  const activeModels = state.models.filter((m) => isModelActiveInMemory(m));
  const activeRouter = getRouterProfile(state.settings.activeRouterId);
  const isDevMode = state.settings.developerMode;

  return (
    <div
      className="min-h-screen flex relative"
      style={{ color: 'var(--pebble-text-primary)' }}
    >
      <AmbientBackdrop
        tokens={activeThemeTokens}
        animationStyle={state.settings.backgroundAnimation}
        customBackgroundUrl={state.settings.customBackgroundUrl}
      />

      <Sidebar
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        developerMode={isDevMode}
        theme={activeThemeTokens.isDark ? 'dark' : 'light'}
        onToggleTheme={() =>
          void updateSettings({
            themePreset: activeThemeTokens.isDark ? 'morning_cloud' : 'misty_evergreen',
            theme: activeThemeTokens.isDark ? 'light' : 'dark',
            aiCustomTheme: null,
          })
        }
        smartResourceMode={state.settings.smartResourceMode}
        activeModelCount={activeModels.length}
        remoteEnabled={state.settings.remoteEnabled}
      />

      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        {/* Clean Translucent Workspace Header */}
        <header className="h-14 px-6 border-b border-[var(--pebble-panel-border)] pebble-glass-subtle flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2 text-xs text-[var(--pebble-text-secondary)] min-w-0">
            <span className="font-display font-semibold text-sm text-[var(--pebble-text-primary)] whitespace-nowrap">
              {SECTION_TITLES[activeSection]}
            </span>
            <span aria-hidden="true">·</span>
            <span className="truncate font-mono">
              {activeRouter.name} ({state.settings.omniMode})
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono text-[var(--pebble-text-secondary)] tabular-nums shrink-0">
            {isDevMode && (
              <>
                <span className="hidden sm:inline">
                  RAM {state.hardware.usedRamGb}/{state.hardware.totalRamGb}G
                </span>
                <span className="hidden md:inline">
                  VRAM {state.hardware.gpuVramUsedGb}/{state.settings.maxVramBudgetGb}G
                </span>
              </>
            )}
            <button
              type="button"
              onClick={() => setActiveSection(isDevMode ? 'routers' : 'settings')}
              className="px-3 py-1.5 rounded-lg pebble-glass-subtle text-[var(--pebble-text-primary)] hover:opacity-85 transition-opacity whitespace-nowrap"
            >
              {activeModels.length > 0 ? activeModels[0].name : `${activeRouter.name} Ready`}
            </button>
          </div>
        </header>

        {/* Active Workspace Section */}
        <main className="flex-1 overflow-y-auto">
          {activeSection === 'home' && (
            <HomeDashboard
              state={state}
              onNavigate={setActiveSection}
              onQuickChat={(prompt, options) => {
                if (prompt) setPendingChatPrompt(prompt);
                if (options?.startVoice) setPendingVoiceStart(true);
                setActiveSection('chat');
              }}
              onQuickImage={(prompt) => {
                setPendingImagePrompt(prompt);
                setActiveSection('image');
              }}
              onOpenConversation={(id) => {
                setActiveConversationId(id);
                setActiveSection('chat');
              }}
            />
          )}

          {activeSection === 'chat' && (
            <ChatView
              conversations={state.conversations}
              activeConversationId={activeConversationId}
              onSelectConversation={setActiveConversationId}
              models={state.models}
              settings={state.settings}
              pendingPrompt={pendingChatPrompt}
              pendingVoiceStart={pendingVoiceStart}
              onConsumePendingPrompt={() => {
                setPendingChatPrompt(null);
                setPendingVoiceStart(false);
              }}
              onOpenImageLab={() => setActiveSection('image')}
              onStateRefresh={refreshState}
            />
          )}

          {activeSection === 'image' && (
            <ImageStudioView
              images={state.images}
              models={state.models}
              settings={state.settings}
              pendingPrompt={pendingImagePrompt}
              onConsumePendingPrompt={() => setPendingImagePrompt(null)}
              onStateRefresh={refreshState}
            />
          )}

          {isDevMode && activeSection === 'voice' && (
            <VoiceView
              voiceHistory={state.voiceHistory}
              settings={state.settings}
              hardware={state.hardware}
              models={state.models}
              onUpdateSettings={updateSettings}
              onStateRefresh={refreshState}
            />
          )}

          {activeSection === 'agent' && (
            <AgentView
              agentTasks={state.agentTasks}
              models={state.models}
              settings={state.settings}
              onStateRefresh={refreshState}
            />
          )}

          {isDevMode && activeSection === 'models' && (
            <ModelsView
              models={state.models}
              hardware={state.hardware}
              onStateRefresh={refreshState}
            />
          )}

          {isDevMode && activeSection === 'routers' && (
            <RoutersView
              settings={state.settings}
              hardware={state.hardware}
              models={state.models}
              queue={state.queue}
              routingHistory={state.routingHistory}
              memoryHistory={state.memoryHistory}
              onStateRefresh={refreshState}
            />
          )}

          {isDevMode && activeSection === 'remote' && (
            <RemoteView
              settings={state.settings}
              remoteDevices={state.remoteDevices}
              queue={state.queue}
              onUpdateSettings={updateSettings}
              onStateRefresh={refreshState}
            />
          )}

          {activeSection === 'settings' && (
            <SettingsView
              settings={state.settings}
              hardware={state.hardware}
              models={state.models}
              queue={state.queue}
              routingHistory={state.routingHistory}
              memoryHistory={state.memoryHistory}
              remoteDevices={state.remoteDevices}
              onUpdateSettings={updateSettings}
              onStateRefresh={refreshState}
            />
          )}
        </main>
      </div>
    </div>
  );
}
