import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  assertModelCanUseTool,
  type PcControlCommand,
} from '../src/core/safety';
import type { ModelEntry, PebbleSettings, RouterId } from '../src/core/types';

const execFileAsync = promisify(execFile);

export interface PcControlExecutionResult {
  allowed: boolean;
  executedOnHost: boolean;
  transport: 'win32_worker' | 'windows_powershell_user32' | 'sandbox_host_preview';
  command: PcControlCommand;
  message: string;
}

/**
 * Executes a host PC mouse or keyboard action.
 * SECURITY POLICY: Always enforces `assertModelCanUseTool` first — any uncensored model or
 * uncensored router immediately throws a policy denial error and never reaches host input APIs.
 */
export async function executeHostPcControl(params: {
  command: PcControlCommand;
  model?: Pick<ModelEntry, 'id' | 'name' | 'censorship'> | null;
  routerId?: RouterId | string | null;
  settings: PebbleSettings;
}): Promise<PcControlExecutionResult> {
  // Hard security gate — uncensored models never control mouse or keyboard
  assertModelCanUseTool(params.command.action, params.model, params.routerId);

  const workerUrl = params.settings.localWorkers.pcControlWorkerUrl || 'http://127.0.0.1:7863';

  // 1. Attempt local Windows PC control worker (pc_control_worker.py)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${workerUrl.replace(/\/$/, '')}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params.command),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json()) as { ok?: boolean; detail?: string };
      return {
        allowed: true,
        executedOnHost: true,
        transport: 'win32_worker',
        command: params.command,
        message: `${data.detail || params.command.summary} via Win32 Worker (${workerUrl}).`,
      };
    }
  } catch {
    // Worker not running locally; try native Windows fallback if running on Windows
  }

  // 2. Native Windows 11 PowerShell + User32 fallback (when running directly on Windows)
  if (process.platform === 'win32') {
    try {
      const script = buildWindowsPowershellInputScript(params.command);
      await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        timeout: 4000,
      });
      return {
        allowed: true,
        executedOnHost: true,
        transport: 'windows_powershell_user32',
        command: params.command,
        message: `Executed on Windows host: ${params.command.summary}`,
      };
    } catch (err) {
      throw new Error(`Windows host input dispatch failed: ${(err as Error).message}`);
    }
  }

  // 3. Truthful telemetry when hosted inside a Linux/web container without an attached Windows desktop
  return {
    allowed: true,
    executedOnHost: false,
    transport: 'sandbox_host_preview',
    command: params.command,
    message: `Authorized for censored model (${params.model?.name || 'Standard'}): ${params.command.summary}. Start pc_control_worker.py on your Windows 11 host for physical cursor/keyboard actuation.`,
  };
}

function buildWindowsPowershellInputScript(cmd: PcControlCommand): string {
  const header = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class PebbleWinInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
}
"@
Add-Type -AssemblyName System.Windows.Forms
`;
  if (cmd.action === 'mouse_move') {
    return `${header}\n[PebbleWinInput]::SetCursorPos(${Number(cmd.x || 0)}, ${Number(cmd.y || 0)})`;
  }
  if (cmd.action === 'mouse_click') {
    const pos =
      cmd.x !== undefined && cmd.y !== undefined
        ? `[PebbleWinInput]::SetCursorPos(${Number(cmd.x)}, ${Number(cmd.y)}); Start-Sleep -Milliseconds 30;`
        : '';
    const down = cmd.button === 'right' ? '0x0008' : cmd.button === 'middle' ? '0x0020' : '0x0002';
    const up = cmd.button === 'right' ? '0x0010' : cmd.button === 'middle' ? '0x0040' : '0x0004';
    const clickOnce = `[PebbleWinInput]::mouse_event(${down},0,0,0,0); [PebbleWinInput]::mouse_event(${up},0,0,0,0);`;
    return `${header}\n${pos}\n${clickOnce}${cmd.doubleClick ? `\nStart-Sleep -Milliseconds 45; ${clickOnce}` : ''}`;
  }
  if (cmd.action === 'mouse_scroll') {
    return `${header}\n[PebbleWinInput]::mouse_event(0x0800, 0, 0, ${Number(cmd.deltaY || -120)}, 0)`;
  }
  if (cmd.action === 'keyboard_type') {
    const safe = (cmd.text || '').replace(/'/g, "''");
    return `${header}\n[System.Windows.Forms.SendKeys]::SendWait('${safe}')`;
  }
  const sendKeysMap: Record<string, string> = {
    ctrl: '^',
    alt: '%',
    shift: '+',
    enter: '{ENTER}',
    tab: '{TAB}',
    esc: '{ESC}',
    escape: '{ESC}',
  };
  const combo = (cmd.keys || []).map((k) => sendKeysMap[k.toLowerCase()] || k).join('');
  return `${header}\n[System.Windows.Forms.SendKeys]::SendWait('${combo.replace(/'/g, "''")}')`;
}
