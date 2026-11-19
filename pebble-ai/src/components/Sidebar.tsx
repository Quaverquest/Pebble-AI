import React from 'react';
import {
  Bot,
  Boxes,
  GitBranch,
  Home,
  Image as ImageIcon,
  MessageSquare,
  Mic,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
  Wifi,
} from 'lucide-react';
import type { NavSection } from '../core/types';

interface SidebarProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  developerMode: boolean;
  smartResourceMode: boolean;
  activeModelCount: number;
  remoteEnabled: boolean;
}

const CONSUMER_NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  icon: React.FC<{ className?: string }>;
}> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'image', label: 'Image Lab', icon: ImageIcon },
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const DEVELOPER_NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  icon: React.FC<{ className?: string }>;
}> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'image', label: 'Image Lab', icon: ImageIcon },
  { id: 'voice', label: 'Voice', icon: Mic },
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'models', label: 'Models', icon: Boxes },
  { id: 'routers', label: 'Routers', icon: GitBranch },
  { id: 'remote', label: 'Remote', icon: Wifi },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSelectSection,
  collapsed,
  onToggleCollapse,
  theme,
  onToggleTheme,
  developerMode,
  smartResourceMode,
  activeModelCount,
  remoteEnabled,
}) => {
  const navItems = developerMode ? DEVELOPER_NAV_ITEMS : CONSUMER_NAV_ITEMS;

  return (
    <aside
      aria-label="Primary Sidebar Navigation"
      className={`flex flex-col border-r border-black/10 dark:border-white/[0.12] pebble-glass-subtle transition-all duration-200 shrink-0 ${
        collapsed ? 'w-[68px]' : 'w-[228px]'
      }`}
    >
      {/* Brand Row */}
      <div className="h-14 px-3.5 flex items-center justify-between border-b border-black/10 dark:border-white/[0.1]">
        {!collapsed && (
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 shadow-sm"
              style={{ backgroundColor: 'var(--pebble-accent)', color: 'var(--pebble-accent-text)' }}
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3c4.8 0 8.5 3.4 8.5 8.2 0 4.6-3.7 9.8-8.5 9.8S3.5 15.8 3.5 11.2C3.5 6.4 7.2 3 12 3Z" />
                <circle cx="12" cy="11" r="2.5" fill="currentColor" />
              </svg>
            </div>
            <span className="font-display font-semibold text-[15px] tracking-tight text-neutral-950 dark:text-white whitespace-nowrap truncate">
              Pebble AI
            </span>
          </div>
        )}
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="p-2 rounded-lg text-neutral-600 dark:text-neutral-300 hover:text-neutral-950 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/[0.08] transition-colors shrink-0"
        >
          {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation Links (Zero keybind badges) */}
      <nav className="flex-1 px-2.5 py-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectSection(item.id)}
              aria-current={isActive ? 'page' : undefined}
              title={collapsed ? item.label : undefined}
              style={
                isActive
                  ? {
                      backgroundColor: 'var(--pebble-accent)',
                      color: 'var(--pebble-accent-text)',
                    }
                  : undefined
              }
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13.5px] font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? 'shadow-sm'
                  : 'text-neutral-700 dark:text-neutral-300 hover:text-neutral-950 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/[0.08]'
              }`}
            >
              <Icon className="w-[18px] h-[18px] shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Bottom Status (Developer mode details only when enabled) & Light/Dark Toggle */}
      <div className="p-3 border-t border-black/10 dark:border-white/[0.1] space-y-2.5">
        {!collapsed && developerMode && (
          <div className="px-2 py-1.5 text-xs text-neutral-600 dark:text-neutral-300 space-y-1">
            <div className="flex items-center justify-between">
              <span>Smart Resource</span>
              <span className="font-mono tabular-nums text-neutral-900 dark:text-white">
                {smartResourceMode ? 'Active' : 'Manual'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Loaded Models</span>
              <span className="font-mono tabular-nums text-neutral-900 dark:text-white">
                {activeModelCount}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Wi-Fi Remote</span>
              <span className="font-mono tabular-nums text-neutral-900 dark:text-white">
                {remoteEnabled ? 'Ready' : 'Off'}
              </span>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-black/10 dark:border-white/15 text-xs font-medium text-neutral-800 dark:text-neutral-200 hover:bg-black/5 dark:hover:bg-white/[0.08] transition-colors whitespace-nowrap"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          {!collapsed && <span>{theme === 'dark' ? 'Light Surface' : 'Dark Surface'}</span>}
        </button>
      </div>
    </aside>
  );
};
