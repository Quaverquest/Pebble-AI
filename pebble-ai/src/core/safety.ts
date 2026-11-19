import type { AgentStep, CensorshipMode, ModelEntry, RouterId } from './types';

export type PcControlTool =
  | 'mouse_move'
  | 'mouse_click'
  | 'mouse_scroll'
  | 'keyboard_type'
  | 'keyboard_hotkey';

export type HostFileTool =
  | 'list_files'
  | 'read_file'
  | 'write_file'
  | 'create_directory'
  | 'search_files';

export const PC_CONTROL_TOOLS: readonly PcControlTool[] = [
  'mouse_move',
  'mouse_click',
  'mouse_scroll',
  'keyboard_type',
  'keyboard_hotkey',
];

export const HOST_FILE_TOOLS: readonly HostFileTool[] = [
  'list_files',
  'read_file',
  'write_file',
  'create_directory',
  'search_files',
];

export interface PcControlCommand {
  action: PcControlTool;
  x?: number;
  y?: number;
  button?: 'left' | 'right' | 'middle';
  doubleClick?: boolean;
  deltaY?: number;
  text?: string;
  keys?: string[];
  summary: string;
}

/**
 * Determines whether a model or active router represents an uncensored profile.
 * Uncensored models are strictly isolated from ALL host PC access (mouse, keyboard, and files).
 */
export function isUncensoredModelOrRouter(
  model?: Pick<ModelEntry, 'id' | 'name' | 'censorship'> | null,
  routerId?: RouterId | string | null
): boolean {
  if (routerId === 'uncensored') return true;
  if (!model) return false;
  if (model.censorship === 'uncensored') return true;
  const idLower = (model.id || '').toLowerCase();
  const nameLower = (model.name || '').toLowerCase();
  return idLower.includes('uncensored') || nameLower.includes('uncensored');
}

export function getEffectiveCensorshipMode(
  model?: Pick<ModelEntry, 'id' | 'name' | 'censorship'> | null,
  routerId?: RouterId | string | null
): CensorshipMode {
  return isUncensoredModelOrRouter(model, routerId) ? 'uncensored' : 'censored';
}

export function isHostRestrictedTool(tool: AgentStep['tool'] | string): boolean {
  return (
    (PC_CONTROL_TOOLS as readonly string[]).includes(tool) ||
    (HOST_FILE_TOOLS as readonly string[]).includes(tool)
  );
}

/**
 * Checks whether the given model/router is permitted to control the host PC
 * (mouse, keyboard, or local files). Only explicitly censored/standard models are allowed.
 */
export function canModelControlPc(
  model?: Pick<ModelEntry, 'id' | 'name' | 'censorship'> | null,
  routerId?: RouterId | string | null
): { allowed: boolean; reason: string } {
  if (isUncensoredModelOrRouter(model, routerId)) {
    const label = routerId === 'uncensored' ? 'Uncensored Creative Router' : model?.name || 'Uncensored model';
    return {
      allowed: false,
      reason: `Security policy: ${label} is uncensored and is strictly blocked from accessing the host PC (no mouse, keyboard, or filesystem tools). Uncensored models may only run sandboxed chat, reasoning, and image generation.`,
    };
  }
  return {
    allowed: true,
    reason: `${model?.name || 'Standard censored model'} is authorized for host PC mouse, keyboard, and workspace actions.`,
  };
}

/**
 * Throws a clear policy error if an uncensored model attempts any PC mouse, keyboard, or file tool.
 */
export function assertModelCanUseTool(
  tool: AgentStep['tool'] | string,
  model?: Pick<ModelEntry, 'id' | 'name' | 'censorship'> | null,
  routerId?: RouterId | string | null
): void {
  if (!isHostRestrictedTool(tool)) {
    return;
  }
  const policy = canModelControlPc(model, routerId);
  if (!policy.allowed) {
    throw new Error(policy.reason);
  }
}

/**
 * Filters candidate agent tools by censorship policy so uncensored models only see
 * non-PC capabilities ('reason_summary' and 'generate_image').
 */
export function getAllowedAgentTools(
  model?: Pick<ModelEntry, 'id' | 'name' | 'censorship'> | null,
  routerId?: RouterId | string | null
): AgentStep['tool'][] {
  const { allowed } = canModelControlPc(model, routerId);
  if (!allowed) {
    return ['reason_summary', 'generate_image'];
  }
  return [
    'list_files',
    'read_file',
    'write_file',
    'create_directory',
    'search_files',
    'generate_image',
    'reason_summary',
    'mouse_move',
    'mouse_click',
    'mouse_scroll',
    'keyboard_type',
    'keyboard_hotkey',
  ];
}

/**
 * Parses natural spoken or typed PC automation requests into concrete mouse/keyboard commands.
 * Used by both Agent Mode and Voice Mode (strictly gated by `canModelControlPc`).
 */
export function parsePcControlCommand(prompt: string): PcControlCommand | null {
  const raw = prompt.trim();
  const lower = raw.toLowerCase();

  // Move mouse to X, Y
  const moveMatch = lower.match(/\b(?:move|point|cursor|mouse)\b.*?\b(\d{1,4})\s*[,x\s]+\s*(\d{1,4})\b/);
  if (moveMatch) {
    const x = Math.min(3840, Math.max(0, Number(moveMatch[1])));
    const y = Math.min(2160, Math.max(0, Number(moveMatch[2])));
    return {
      action: 'mouse_move',
      x,
      y,
      summary: `Move mouse cursor to (${x}, ${y})`,
    };
  }

  // Click mouse (with optional coordinates, right click, double click)
  if (/\b(double[\s-]?click|right[\s-]?click|left[\s-]?click|click mouse|click at|click the mouse|click)\b/i.test(lower)) {
    const coords = lower.match(/\b(\d{1,4})\s*[,x\s]+\s*(\d{1,4})\b/);
    const button: 'left' | 'right' | 'middle' = /\bright\b/.test(lower)
      ? 'right'
      : /\bmiddle\b/.test(lower)
        ? 'middle'
        : 'left';
    const doubleClick = /\bdouble\b/.test(lower);
    const x = coords ? Math.min(3840, Math.max(0, Number(coords[1]))) : undefined;
    const y = coords ? Math.min(2160, Math.max(0, Number(coords[2]))) : undefined;
    return {
      action: 'mouse_click',
      x,
      y,
      button,
      doubleClick,
      summary: `${doubleClick ? 'Double ' : ''}${button} click${x !== undefined && y !== undefined ? ` at (${x}, ${y})` : ' at current cursor'}`,
    };
  }

  // Scroll wheel
  const scrollMatch = lower.match(/\bscroll\s+(up|down)(?:\s+(\d+))?\b/);
  if (scrollMatch) {
    const dir = scrollMatch[1] === 'up' ? 1 : -1;
    const amount = Number(scrollMatch[2] || 3) * 120 * dir;
    return {
      action: 'mouse_scroll',
      deltaY: amount,
      summary: `Scroll mouse wheel ${scrollMatch[1]} (${Math.abs(amount)} units)`,
    };
  }

  // Keyboard hotkey (ctrl+c, alt+tab, win+d, enter, escape, etc.)
  const hotkeyMatch = raw.match(/\b(?:press|hotkey|shortcut|hit)\s+([a-zA-Z0-9+\-\s]{2,28})$/i);
  if (hotkeyMatch) {
    const keys = hotkeyMatch[1]
      .split(/[+\s]+/)
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 4);
    if (keys.length > 0) {
      return {
        action: 'keyboard_hotkey',
        keys,
        summary: `Press keyboard shortcut ${keys.join(' + ').toUpperCase()}`,
      };
    }
  }

  // Keyboard typing (type "hello" or type hello world)
  const quotedType = raw.match(/\b(?:type|write on keyboard|enter text)\s+["'](.+?)["']/i);
  if (quotedType) {
    const text = quotedType[1];
    return {
      action: 'keyboard_type',
      text,
      summary: `Type "${text}" via host keyboard`,
    };
  }
  const plainType = raw.match(/^(?:please\s+)?(?:type|keyboard type)\s+(.{1,160})$/i);
  if (plainType && !/\b(file|essay|report|story|code|summary)\b/i.test(plainType[1])) {
    const text = plainType[1].trim();
    return {
      action: 'keyboard_type',
      text,
      summary: `Type "${text}" via host keyboard`,
    };
  }

  return null;
}
