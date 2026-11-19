import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  FileCode2,
  FolderOpen,
  Keyboard,
  Lock,
  MousePointer2,
  Play,
  ShieldAlert,
  ShieldCheck,
  Square,
  XCircle,
} from 'lucide-react';
import { canModelControlPc } from '../core/safety';
import type { AgentTask, ModelEntry, PebbleSettings } from '../core/types';

interface AgentViewProps {
  agentTasks: AgentTask[];
  models: ModelEntry[];
  settings: PebbleSettings;
  onStateRefresh: () => Promise<void>;
}

const PC_CONTROL_PRESETS = [
  'Move mouse to 640, 360 and click',
  'Type "Hello from Pebble Agent" using host keyboard',
  'Press ctrl+c hotkey on host PC',
  'Scroll down 3',
];

const WORKSPACE_PRESETS = [
  'Inspect notes/victus-optimization-notes.md and scripts/check_memory_budget.py, then write a concise hardware summary report to reports/victus-summary.md.',
];

const UNCENSORED_PRESETS = [
  'Generate a stylized cyberpunk workshop image via Pebble Image',
  'Summarize creative architectural principles for compact 4GB local AI studios',
];

export const AgentView: React.FC<AgentViewProps> = ({
  agentTasks,
  models,
  settings,
  onStateRefresh,
}) => {
  const [goal, setGoal] = useState(
    'Move mouse to 640, 360 and click'
  );
  const [selectedModelId, setSelectedModelId] = useState<string>('auto');
  const [planning, setPlanning] = useState(false);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [workingDir, setWorkingDir] = useState('');
  const [previewFile, setPreviewFile] = useState<{ path: string; content: string } | null>(null);
  const [selectedApprovals, setSelectedApprovals] = useState<Record<string, boolean>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const agentCandidateModels = models.filter(
    (m) =>
      m.supportedTasks.includes('general_chat') ||
      m.supportedTasks.includes('coding') ||
      m.supportedTasks.includes('reasoning')
  );

  const explicitModel =
    selectedModelId === 'auto'
      ? agentCandidateModels.find((m) => m.id === 'pebble-chat-normal') ?? null
      : agentCandidateModels.find((m) => m.id === selectedModelId) ?? null;

  const pcPolicy = canModelControlPc(
    explicitModel,
    selectedModelId === 'auto' ? settings.activeRouterId : 'omni'
  );

  const activeTask = agentTasks[0] ?? null;

  const fetchWorkspace = async () => {
    const res = await fetch('/api/agent/workspace');
    if (res.ok) {
      const data = await res.json();
      setWorkspaceFiles(data.files ?? []);
      setWorkingDir(data.workingDirectory ?? '');
    }
  };

  useEffect(() => {
    void fetchWorkspace();
  }, [agentTasks.length]);

  useEffect(() => {
    if (activeTask) {
      const defaults: Record<string, boolean> = {};
      for (const s of activeTask.steps) {
        if (s.requiresApproval) defaults[s.id] = true;
      }
      setSelectedApprovals(defaults);
    }
  }, [activeTask?.id]);

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goal.trim() || planning) return;
    setPlanning(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/agent/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: goal.trim(),
          modelId: selectedModelId === 'auto' ? undefined : selectedModelId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to plan agent task.');
      await onStateRefresh();
      await fetchWorkspace();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setPlanning(false);
    }
  };

  const handleApproveAndRun = async (task: AgentTask) => {
    setExecutingId(task.id);
    setErrorMsg(null);
    try {
      const approvedStepIds = Object.entries(selectedApprovals)
        .filter(([, ok]) => ok)
        .map(([id]) => id);

      const res = await fetch(`/api/agent/${task.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedStepIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Agent execution failed.');
      await onStateRefresh();
      await fetchWorkspace();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setExecutingId(null);
    }
  };

  const handleCancel = async (taskId: string) => {
    await fetch(`/api/agent/${taskId}/cancel`, { method: 'POST' });
    await onStateRefresh();
  };

  const openWorkspaceFile = async (relPath: string) => {
    if (relPath.endsWith('/')) return;
    const res = await fetch(`/api/agent/file?path=${encodeURIComponent(relPath)}`);
    if (res.ok) {
      const data = await res.json();
      setPreviewFile(data);
    }
  };

  return (
    <div className="max-w-[1320px] mx-auto px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--pebble-panel-border)] pb-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">
            Pebble Autonomous Agent
          </h1>
          <p className="text-xs text-[var(--pebble-text-secondary)] mt-1">
            Workspace: <span className="font-mono">{workingDir || 'data/agent_workspace'}</span> · Mouse &amp; Keyboard Control (Censored Models Only)
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <label htmlFor="agent-model-select" className="text-xs text-[var(--pebble-text-secondary)]">
            Agent Model:
          </label>
          <select
            id="agent-model-select"
            value={selectedModelId}
            onChange={(e) => setSelectedModelId(e.target.value)}
            className="px-3 py-1.5 rounded-xl pebble-glass-subtle text-xs font-medium max-w-[260px]"
          >
            <option value="auto">Auto ({settings.activeRouterId.replace(/_/g, ' ')})</option>
            {agentCandidateModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.censorship === 'uncensored' ? 'Uncensored — No PC Access' : 'Censored — PC Control'})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Security Boundary Indicator Banner */}
      <div
        className={`rounded-2xl p-4 border flex flex-wrap items-center justify-between gap-3 text-xs ${
          pcPolicy.allowed
            ? 'border-emerald-600/35 bg-emerald-700/12 text-emerald-800 dark:text-emerald-200'
            : 'border-amber-600/40 bg-amber-600/15 text-amber-800 dark:text-amber-200'
        }`}
      >
        <div className="flex items-center gap-2.5">
          {pcPolicy.allowed ? (
            <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <Lock className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
          )}
          <div>
            <span className="font-semibold">
              {pcPolicy.allowed
                ? 'Host PC Mouse, Keyboard & Workspace Authorized'
                : 'Uncensored Isolation Active — Zero PC Mouse, Keyboard, or File Access'}
            </span>
            <p className="opacity-85 mt-0.5">{pcPolicy.reason}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] opacity-90">
          {pcPolicy.allowed ? (
            <>
              <span className="inline-flex items-center gap-1"><MousePointer2 className="w-3.5 h-3.5" /> Mouse</span>
              <span>·</span>
              <span className="inline-flex items-center gap-1"><Keyboard className="w-3.5 h-3.5" /> Keyboard</span>
            </>
          ) : (
            <span>Sandboxed Reasoning &amp; Image Gen Only</span>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-xl border border-red-500/30 bg-red-500/15 text-xs text-red-700 dark:text-red-300">
          {errorMsg}
        </div>
      )}

      {/* Goal Input + Quick Presets */}
      <form
        onSubmit={handleCreatePlan}
        className="rounded-2xl pebble-glass p-5 space-y-3"
      >
        <label htmlFor="agent-goal-input" className="block text-xs font-medium text-[var(--pebble-text-secondary)]">
          Describe Multi-Step Task or Host PC Mouse / Keyboard Action
        </label>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            id="agent-goal-input"
            type="text"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder={
              pcPolicy.allowed
                ? 'e.g. Move mouse to 640, 360 and click, or type "Hello" via host keyboard...'
                : 'Describe non-PC creative reasoning or image generation task...'
            }
            className="flex-1 px-3.5 py-2.5 rounded-xl pebble-glass-subtle text-sm"
          />
          <button
            type="submit"
            disabled={planning || !goal.trim()}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl pebble-accent-btn disabled:opacity-50 text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{planning ? 'Creating Plan...' : 'Create Execution Plan'}</span>
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 pt-1">
          {pcPolicy.allowed
            ? [...PC_CONTROL_PRESETS, ...WORKSPACE_PRESETS].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setGoal(preset)}
                  className="px-2.5 py-1 rounded-lg pebble-glass-subtle text-[11px] hover:opacity-85 text-left"
                >
                  {preset.length > 62 ? `${preset.slice(0, 62)}...` : preset}
                </button>
              ))
            : UNCENSORED_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setGoal(preset)}
                  className="px-2.5 py-1 rounded-lg pebble-glass-subtle text-[11px] hover:opacity-85 text-left"
                >
                  {preset}
                </button>
              ))}
        </div>
      </form>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Execution Plan & Logs */}
        <div className="lg:col-span-8 space-y-5">
          {activeTask ? (
            <div className="rounded-2xl pebble-glass p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--pebble-panel-border)]">
                <div>
                  <div className="text-xs font-mono text-[var(--pebble-accent)]">
                    {activeTask.status.replace(/_/g, ' ')} · {activeTask.selectedModelName} ·{' '}
                    {activeTask.modelCensorship === 'uncensored' ? 'Uncensored Isolated' : 'Censored PC Authorized'}
                  </div>
                  <h2 className="font-display text-base font-semibold mt-0.5">
                    {activeTask.goal}
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  {(activeTask.status === 'awaiting_approval' || activeTask.status === 'running') && (
                    <>
                      <button
                        type="button"
                        disabled={executingId === activeTask.id}
                        onClick={() => void handleApproveAndRun(activeTask)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl pebble-accent-btn disabled:opacity-50 text-xs font-semibold whitespace-nowrap"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>
                          {executingId === activeTask.id ? 'Executing...' : 'Approve & Execute Plan'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCancel(activeTask.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl pebble-glass-subtle text-xs hover:opacity-85 whitespace-nowrap"
                      >
                        <Square className="w-3.5 h-3.5" />
                        <span>Cancel</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Steps */}
              <div className="space-y-2.5">
                {activeTask.steps.map((step) => (
                  <div
                    key={step.id}
                    className="p-3.5 rounded-xl pebble-glass-subtle space-y-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-0.5">
                        <div className="text-xs font-mono text-[var(--pebble-text-secondary)]">
                          Step {step.index} · {step.tool} · {step.status}
                        </div>
                        <div className="text-sm font-medium">
                          {step.title}
                        </div>
                      </div>

                      {step.requiresApproval && step.approvalStatus === 'pending' && (
                        <label className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-300 cursor-pointer shrink-0">
                          <input
                            type="checkbox"
                            checked={selectedApprovals[step.id] ?? true}
                            onChange={(e) =>
                              setSelectedApprovals((prev) => ({
                                ...prev,
                                [step.id]: e.target.checked,
                              }))
                            }
                            className="accent-emerald-700"
                          />
                          <ShieldAlert className="w-3.5 h-3.5" />
                          <span>Approve</span>
                        </label>
                      )}
                      {step.status === 'completed' && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      )}
                      {step.status === 'failed' && (
                        <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                      )}
                    </div>

                    {step.preview && (
                      <pre className="p-2.5 rounded-lg bg-black/20 border border-[var(--pebble-panel-border)] text-[11px] font-mono overflow-x-auto">
                        {step.preview}
                      </pre>
                    )}

                    {step.output && (
                      <pre className="p-2.5 rounded-lg bg-neutral-950/90 text-[11px] font-mono text-emerald-300 overflow-x-auto max-h-40">
                        {step.output}
                      </pre>
                    )}
                  </div>
                ))}
              </div>

              {/* Execution Logs */}
              <div className="pt-2 border-t border-[var(--pebble-panel-border)] space-y-1.5">
                <div className="text-xs font-medium text-[var(--pebble-text-secondary)]">
                  Execution Log
                </div>
                <div className="p-3 rounded-xl bg-neutral-950/90 font-mono text-[11px] text-neutral-300 space-y-1 max-h-36 overflow-y-auto tabular-nums">
                  {activeTask.logs.map((log, idx) => (
                    <div key={idx}>
                      <span className="text-neutral-500">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>{' '}
                      <span
                        className={
                          log.level === 'error'
                            ? 'text-red-400'
                            : log.level === 'warn'
                              ? 'text-amber-400'
                              : 'text-emerald-400'
                        }
                      >
                        [{log.level}]
                      </span>{' '}
                      {log.message}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl pebble-glass p-10 text-center text-sm text-[var(--pebble-text-secondary)]">
              Submit a goal above to plan mouse/keyboard automation, workspace file analysis, or sandboxed tasks.
            </div>
          )}

          {agentTasks.length > 1 && (
            <div className="rounded-2xl pebble-glass p-5 space-y-2">
              <h3 className="font-display text-sm font-semibold">
                Previous Agent Tasks
              </h3>
              <div className="divide-y divide-[var(--pebble-panel-border)] text-xs">
                {agentTasks.slice(1, 6).map((t) => (
                  <div key={t.id} className="py-2 flex items-center justify-between gap-2">
                    <span className="truncate">{t.goal}</span>
                    <span className="font-mono text-[var(--pebble-text-secondary)] shrink-0">{t.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sandboxed Workspace Explorer */}
        <div className="lg:col-span-4 rounded-2xl pebble-glass p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-[var(--pebble-accent)]" />
              <span>Workspace Files</span>
            </h2>
            <span className="text-xs font-mono text-[var(--pebble-text-secondary)] tabular-nums">
              {workspaceFiles.filter((f) => !f.endsWith('/')).length} files
            </span>
          </div>

          {!pcPolicy.allowed ? (
            <div className="p-3 rounded-xl border border-amber-600/30 bg-amber-600/10 text-xs text-amber-700 dark:text-amber-300">
              File access disabled for uncensored models. Switch to a censored model to read or write workspace files.
            </div>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto text-xs font-mono">
              {workspaceFiles.map((file) => (
                <button
                  key={file}
                  type="button"
                  disabled={file.endsWith('/')}
                  onClick={() => void openWorkspaceFile(file)}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-white/10 flex items-center gap-2 disabled:opacity-60"
                >
                  <FileCode2 className="w-3.5 h-3.5 text-[var(--pebble-accent)] shrink-0" />
                  <span className="truncate">{file}</span>
                </button>
              ))}
            </div>
          )}

          {previewFile && pcPolicy.allowed && (
            <div className="pt-3 border-t border-[var(--pebble-panel-border)] space-y-2">
              <div className="text-xs font-mono text-[var(--pebble-accent)] truncate">
                {previewFile.path}
              </div>
              <pre className="p-3 rounded-xl bg-neutral-950/90 text-[11px] font-mono text-neutral-200 overflow-x-auto max-h-64">
                {previewFile.content}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
