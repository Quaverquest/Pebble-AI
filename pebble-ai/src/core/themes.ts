import type { BackgroundAnimationStyle, CustomUiThemeTokens, ThemePresetId } from './types';

export interface ThemePresetDefinition {
  id: ThemePresetId;
  name: string;
  description: string;
  defaultAnimation: BackgroundAnimationStyle;
  tokens: CustomUiThemeTokens;
}

export const THEME_PRESETS: ThemePresetDefinition[] = [
  {
    id: 'misty_evergreen',
    name: 'Misty Evergreen',
    description: 'Deep pine forest glass surfaces inspired by translucent ambient workspaces.',
    defaultAnimation: 'aurora',
    tokens: {
      isDark: true,
      backdropGradient:
        'radial-gradient(circle at 18% 22%, rgba(92, 164, 146, 0.42) 0%, rgba(28, 63, 62, 0.85) 45%, #0c1718 100%)',
      panelBg: 'rgba(14, 24, 26, 0.62)',
      panelHoverBg: 'rgba(22, 36, 38, 0.72)',
      panelBorder: 'rgba(255, 255, 255, 0.14)',
      textPrimary: '#f3f7f6',
      textSecondary: '#b2c7c3',
      accentColor: '#2f8f79',
      accentHover: '#38a88e',
      accentText: '#ffffff',
      blurPx: 26,
      recommendedAnimation: 'aurora',
    },
  },
  {
    id: 'morning_cloud',
    name: 'Morning Cloud',
    description: 'Airy Windows Mica daylight glass with sky mist and soft porcelain cards.',
    defaultAnimation: 'mesh_drift',
    tokens: {
      isDark: false,
      backdropGradient:
        'radial-gradient(circle at 80% 18%, rgba(169, 206, 232, 0.65) 0%, rgba(226, 238, 247, 0.92) 48%, #e9f0f5 100%)',
      panelBg: 'rgba(255, 255, 255, 0.76)',
      panelHoverBg: 'rgba(255, 255, 255, 0.90)',
      panelBorder: 'rgba(15, 23, 42, 0.09)',
      textPrimary: '#0f172a',
      textSecondary: '#475569',
      accentColor: '#1d6fa5',
      accentHover: '#155a87',
      accentText: '#ffffff',
      blurPx: 24,
      recommendedAnimation: 'mesh_drift',
    },
  },
  {
    id: 'charcoal_studio',
    name: 'Obsidian Slate',
    description: 'Neutral matte graphite acrylic for distraction-free coding and image editing.',
    defaultAnimation: 'particles',
    tokens: {
      isDark: true,
      backdropGradient:
        'radial-gradient(circle at 30% 15%, rgba(56, 78, 72, 0.34) 0%, #111315 55%, #0a0c0d 100%)',
      panelBg: 'rgba(22, 25, 28, 0.72)',
      panelHoverBg: 'rgba(30, 34, 38, 0.82)',
      panelBorder: 'rgba(255, 255, 255, 0.10)',
      textPrimary: '#f5f6f7',
      textSecondary: '#9ca3af',
      accentColor: '#1b6d54',
      accentHover: '#228668',
      accentText: '#ffffff',
      blurPx: 22,
      recommendedAnimation: 'particles',
    },
  },
  {
    id: 'nordic_dusk',
    name: 'Nordic Fjord',
    description: 'Cool cobalt twilight glass with deep marine frosted panels.',
    defaultAnimation: 'starfield',
    tokens: {
      isDark: true,
      backdropGradient:
        'radial-gradient(circle at 75% 20%, rgba(56, 114, 168, 0.45) 0%, rgba(16, 28, 48, 0.92) 55%, #09101d 100%)',
      panelBg: 'rgba(13, 22, 38, 0.65)',
      panelHoverBg: 'rgba(20, 33, 56, 0.76)',
      panelBorder: 'rgba(186, 214, 247, 0.16)',
      textPrimary: '#eef4fb',
      textSecondary: '#a9bdd6',
      accentColor: '#3b82c4',
      accentHover: '#4f94d4',
      accentText: '#ffffff',
      blurPx: 24,
      recommendedAnimation: 'starfield',
    },
  },
  {
    id: 'oceanic_depth',
    name: 'Deep Pacific',
    description: 'Calm teal abyssal acrylic with bioluminescent drift.',
    defaultAnimation: 'aurora',
    tokens: {
      isDark: true,
      backdropGradient:
        'radial-gradient(circle at 25% 75%, rgba(20, 128, 140, 0.42) 0%, rgba(8, 36, 46, 0.92) 55%, #05161d 100%)',
      panelBg: 'rgba(8, 28, 36, 0.66)',
      panelHoverBg: 'rgba(12, 39, 50, 0.76)',
      panelBorder: 'rgba(148, 226, 234, 0.15)',
      textPrimary: '#ecfafb',
      textSecondary: '#9bc4c9',
      accentColor: '#0e9aa7',
      accentHover: '#15b2c1',
      accentText: '#ffffff',
      blurPx: 26,
      recommendedAnimation: 'aurora',
    },
  },
  {
    id: 'amber_solitude',
    name: 'Cedar Dusk',
    description: 'Warm espresso walnut glass illuminated by subtle hearth amber.',
    defaultAnimation: 'mesh_drift',
    tokens: {
      isDark: true,
      backdropGradient:
        'radial-gradient(circle at 72% 28%, rgba(168, 108, 56, 0.38) 0%, rgba(36, 25, 19, 0.92) 58%, #140d0a 100%)',
      panelBg: 'rgba(28, 20, 16, 0.66)',
      panelHoverBg: 'rgba(40, 29, 23, 0.78)',
      panelBorder: 'rgba(255, 224, 194, 0.14)',
      textPrimary: '#fbf5ef',
      textSecondary: '#ccb8a6',
      accentColor: '#c26d2d',
      accentHover: '#d97d38',
      accentText: '#ffffff',
      blurPx: 24,
      recommendedAnimation: 'mesh_drift',
    },
  },
  {
    id: 'solar_dawn',
    name: 'Warm Limestone',
    description: 'Sunlit architectural stone paper with crisp charcoal contrast.',
    defaultAnimation: 'none',
    tokens: {
      isDark: false,
      backdropGradient:
        'radial-gradient(circle at 20% 15%, rgba(236, 219, 196, 0.75) 0%, rgba(244, 240, 232, 0.94) 55%, #eae5dc 100%)',
      panelBg: 'rgba(255, 253, 249, 0.78)',
      panelHoverBg: 'rgba(255, 255, 255, 0.92)',
      panelBorder: 'rgba(60, 48, 36, 0.10)',
      textPrimary: '#1f1b18',
      textSecondary: '#61564b',
      accentColor: '#226b54',
      accentHover: '#1a5643',
      accentText: '#ffffff',
      blurPx: 20,
      recommendedAnimation: 'none',
    },
  },
  {
    id: 'mono_matte',
    name: 'Pure Porcelain',
    description: 'Crisp minimalist white daylight shell inspired by studio drafting tables.',
    defaultAnimation: 'particles',
    tokens: {
      isDark: false,
      backdropGradient:
        'radial-gradient(circle at 50% 0%, rgba(214, 222, 230, 0.55) 0%, #f4f6f8 60%, #eaedf1 100%)',
      panelBg: 'rgba(255, 255, 255, 0.80)',
      panelHoverBg: 'rgba(255, 255, 255, 0.94)',
      panelBorder: 'rgba(15, 23, 42, 0.08)',
      textPrimary: '#111827',
      textSecondary: '#4b5563',
      accentColor: '#111827',
      accentHover: '#1f2937',
      accentText: '#ffffff',
      blurPx: 22,
      recommendedAnimation: 'particles',
    },
  },
];

export function getThemePreset(presetId?: ThemePresetId | string | null): ThemePresetDefinition {
  return THEME_PRESETS.find((t) => t.id === presetId) ?? THEME_PRESETS[0];
}

export function resolveActiveThemeTokens(params: {
  themePreset?: ThemePresetId;
  customBackgroundUrl?: string;
  aiCustomTheme?: CustomUiThemeTokens | null;
}): CustomUiThemeTokens {
  if (params.customBackgroundUrl && params.aiCustomTheme) {
    return params.aiCustomTheme;
  }
  return getThemePreset(params.themePreset).tokens;
}
