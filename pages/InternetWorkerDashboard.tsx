import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import WorkspaceShell from '../components/WorkspaceShell';
import Seo from '../components/Seo';
import { User, WorkerDashboardData, WorkerExecutionLog, WorkerTask, WorkerTaskResult } from '../types';
import { apiUrl } from '../utils/api';

type FeedbackState = {
  type: 'success' | 'error';
  message: string;
} | null;

const taskTemplates = [
  {
    label: 'Price tracker',
    description: 'Monitor products and notify on price movement.',
    prompt: 'Track MacBook price on Amazon every hour and alert me on Telegram'
  },
  {
    label: 'Job monitor',
    description: 'Scan job boards for new remote roles.',
    prompt: 'Find remote React developer jobs daily from LinkedIn'
  },
  {
    label: 'News digest',
    description: 'Collect topic headlines on a recurring schedule.',
    prompt: 'Send top AI news every morning by email'
  },
  {
    label: 'Page change alert',
    description: 'Watch a page and notify when it changes.',
    prompt: 'Notify me if https://openai.com changes'
  }
] as const;

const formatRelativeLabel = (value?: string): string => {
  if (!value) return 'Not yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not yet';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const badgeClasses: Record<WorkerTask['runStatus'], string> = {
  IDLE: 'border-white/10 bg-white/[0.03] text-zinc-300',
  RUNNING: 'border-cyan-400/20 bg-cyan-500/10 text-cyan-100',
  SUCCESS: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100',
  ERROR: 'border-red-400/20 bg-red-500/10 text-red-100'
};

const scheduleLabel = (schedule: WorkerTask['schedule']): string =>
  schedule.charAt(0).toUpperCase() + schedule.slice(1);

const formatPercent = (value: number): string => `${Math.round(value)}%`;

const getNumericPrice = (result: WorkerTaskResult): number | null => {
  const raw = result.resultData?.numeric_price;
  const numeric = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
};

const getResultHighlights = (result: WorkerTaskResult): string[] => {
  const highlights: string[] = [];
  const numericPrice = getNumericPrice(result);
  if (numericPrice !== null) {
    highlights.push(`Price: ${numericPrice.toLocaleString('en-IN', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })}`);
  }

  const matchedPrice = result.resultData?.matched_price;
  if (!highlights.length && typeof matchedPrice === 'string' && matchedPrice.trim()) {
    highlights.push(`Matched value: ${matchedPrice}`);
  }

  const items = Array.isArray(result.resultData?.items)
    ? result.resultData.items.map((item) => String(item)).filter(Boolean).slice(0, 2)
    : [];
  if (items.length > 0) {
    highlights.push(...items);
  }

  const snippet = Array.isArray(result.resultData?.snippet)
    ? result.resultData.snippet.map((item) => String(item)).filter(Boolean).slice(0, 2)
    : [];
  if (!items.length && snippet.length > 0) {
    highlights.push(...snippet);
  }

  const repairedSteps = Number(result.resultData?.repaired_steps || 0);
  if (repairedSteps > 0) {
    highlights.push(`${repairedSteps} repaired step${repairedSteps > 1 ? 's' : ''}`);
  }

  return highlights.slice(0, 3);
};

const buildDashboardState = (result: any): WorkerDashboardData => ({
  tasks: Array.isArray(result.tasks) ? result.tasks : [],
  recentResults: Array.isArray(result.recentResults) ? result.recentResults : [],
  recentLogs: Array.isArray(result.recentLogs) ? result.recentLogs : [],
  stats: result.stats || {
    activeTasks: 0,
    pausedTasks: 0,
    totalRuns: 0,
    successfulRuns: 0,
    detectedChanges: 0
  }
});

const InternetWorkerDashboard: React.FC<{ user: User }> = ({ user }) => {
  const [dashboard, setDashboard] = useState<WorkerDashboardData | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionTaskId, setActionTaskId] = useState('');
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const selectedTask = useMemo(
    () => dashboard?.tasks.find((task) => task.id === selectedTaskId) || dashboard?.tasks[0] || null,
    [dashboard?.tasks, selectedTaskId]
  );

  const selectedTaskResults = useMemo(
    () => dashboard?.recentResults.filter((result) => result.taskId === selectedTask?.id).slice(0, 6) || [],
    [dashboard?.recentResults, selectedTask?.id]
  );

  const selectedTaskLogs = useMemo(
    () => dashboard?.recentLogs.filter((log) => log.taskId === selectedTask?.id).slice(0, 8) || [],
    [dashboard?.recentLogs, selectedTask?.id]
  );

  const selectedTaskSuccessRate = useMemo(() => {
    if (!selectedTask || selectedTask.runCount === 0) return 0;
    return (selectedTask.successCount / selectedTask.runCount) * 100;
  }, [selectedTask]);

  const selectedTaskChangeCount = useMemo(
    () => selectedTaskResults.filter((result) => result.detectedChange).length,
    [selectedTaskResults]
  );

  const selectedTaskPriceSeries = useMemo(
    () => selectedTaskResults
      .map((result) => ({ id: result.id, value: getNumericPrice(result) }))
      .filter((entry): entry is { id: string; value: number } => entry.value !== null)
      .reverse(),
    [selectedTaskResults]
  );

  const selectedTaskPriceBounds = useMemo(() => {
    if (!selectedTaskPriceSeries.length) {
      return { min: 0, max: 0 };
    }
    return {
      min: Math.min(...selectedTaskPriceSeries.map((entry) => entry.value)),
      max: Math.max(...selectedTaskPriceSeries.map((entry) => entry.value))
    };
  }, [selectedTaskPriceSeries]);

  const loadDashboard = async (showSpinner = false) => {
    if (showSpinner) setIsRefreshing(true);
    try {
      const response = await fetch(apiUrl('/worker/tasks'), { credentials: 'include' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(result?.message || 'Failed to load worker dashboard.'));
      }
      setDashboard(buildDashboardState(result));
      setSelectedTaskId((current) => {
        if (current && result.tasks?.some((task: WorkerTask) => task.id === current)) {
          return current;
        }
        return result.tasks?.[0]?.id || '';
      });
    } catch (error) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to load worker dashboard.'
      });
    } finally {
      setIsLoading(false);
      if (showSpinner) setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 3500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const handleCreateTask = async () => {
    if (!prompt.trim()) {
      setFeedback({ type: 'error', message: 'Describe the worker task first.' });
      return;
    }

    setIsCreating(true);
    try {
      const response = await fetch(apiUrl('/worker/tasks'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          description: prompt.trim(),
          runNow: true
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(result?.message || 'Failed to create worker task.'));
      }
      setDashboard(buildDashboardState(result));
      if (result.task?.id) {
        setSelectedTaskId(result.task.id);
      }
      setPrompt('');
      setFeedback({ type: 'success', message: 'Worker task created successfully.' });
    } catch (error) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to create worker task.'
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleTaskAction = async (
    taskId: string,
    action: 'run' | 'toggle' | 'delete',
    task?: WorkerTask
  ) => {
    setActionTaskId(taskId);
    try {
      const request =
        action === 'run'
          ? fetch(apiUrl(`/worker/tasks/${taskId}/run`), {
              method: 'POST',
              credentials: 'include'
            })
          : action === 'toggle'
            ? fetch(apiUrl(`/worker/tasks/${taskId}`), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                  status: task?.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
                })
              })
            : fetch(apiUrl(`/worker/tasks/${taskId}`), {
                method: 'DELETE',
                credentials: 'include'
              });

      const response = await request;
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(result?.message || 'Task action failed.'));
      }

      setDashboard(buildDashboardState(result));
      setSelectedTaskId((current) => {
        if (action === 'delete' && current === taskId) {
          return result.tasks?.[0]?.id || '';
        }
        return current;
      });
      setFeedback({
        type: 'success',
        message:
          action === 'run'
            ? 'Worker run queued successfully.'
            : action === 'toggle'
              ? `Task ${task?.status === 'ACTIVE' ? 'paused' : 'resumed'}.`
              : 'Task deleted.'
      });
    } catch (error) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Task action failed.'
      });
    } finally {
      setActionTaskId('');
    }
  };

  return (
    <>
      <Seo
        title="AI Internet Worker Dashboard | SwiftDeploy"
        description="Create natural-language web automations, monitor scheduled runs, and review results and logs inside the SwiftDeploy dashboard."
        path="/internet-worker"
        keywords="ai internet worker dashboard, website monitoring dashboard, price tracking automation, natural language automation"
      />

      <WorkspaceShell
        activeItem="workers"
        badge="AI Internet Worker"
        title="Describe recurring internet work once, then let it run."
        description="Create worker tasks in plain English, let SwiftDeploy turn them into structured web automations, and review results, repairs, and execution history in one place."
        user={user}
        rightActions={(
          <>
            <button
              type="button"
              onClick={() => void loadDashboard(true)}
              className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-zinc-200 transition-colors hover:border-white/20 hover:bg-white/[0.05]"
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            <Link
              to="/"
              className="rounded-full border border-red-400/20 bg-red-500/12 px-4 py-2 text-sm text-red-100 transition-colors hover:bg-red-500/18"
            >
              Back to site
            </Link>
          </>
        )}
      >
        {feedback ? (
          <div
            className={`mb-5 rounded-2xl border px-4 py-3 text-sm ${
              feedback.type === 'success'
                ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100'
                : 'border-red-400/20 bg-red-500/10 text-red-100'
            }`}
          >
            {feedback.message}
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex min-h-[320px] items-center justify-center rounded-[28px] border border-white/8 bg-[#0d0d0f]">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/10 border-t-white" />
          </div>
        ) : (
          <div className="space-y-6">
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[
                { label: 'Active tasks', value: dashboard?.stats.activeTasks || 0 },
                { label: 'Paused tasks', value: dashboard?.stats.pausedTasks || 0 },
                { label: 'Total runs', value: dashboard?.stats.totalRuns || 0 },
                { label: 'Detected changes', value: dashboard?.stats.detectedChanges || 0 }
              ].map((item) => (
                <article key={item.label} className="rounded-[24px] border border-white/8 bg-[#0d0d0f] p-5">
                  <p className="text-sm text-zinc-500">{item.label}</p>
                  <p className="mt-3 text-3xl font-semibold tracking-tight text-white">{item.value}</p>
                </article>
              ))}
            </section>

            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <section className="space-y-6">
                <article className="rounded-[28px] border border-white/8 bg-[#0d0d0f] p-5 md:p-6">
                  <p className="text-sm font-medium text-red-100">Create worker task</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Natural-language automation</h2>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400">
                    Write the task the way you would delegate it to a person. SwiftDeploy will infer the website, schedule,
                    extraction target, and run flow for the first MVP worker.
                  </p>

                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    rows={5}
                    placeholder="Track MacBook price on Amazon every hour and alert me on Telegram"
                    className="mt-5 w-full rounded-[24px] border border-white/10 bg-[#08080a] px-4 py-4 text-sm leading-7 text-white outline-none placeholder:text-zinc-500 focus:border-white/20"
                  />

                  <div className="mt-5 grid gap-3 md:grid-cols-2">
                    {taskTemplates.map((template) => (
                      <button
                        key={template.label}
                        type="button"
                        onClick={() => setPrompt(template.prompt)}
                        className="rounded-[22px] border border-white/8 bg-[#08080a] p-4 text-left transition-colors hover:border-white/16 hover:bg-white/[0.03]"
                      >
                        <p className="text-sm font-medium text-white">{template.label}</p>
                        <p className="mt-2 text-xs leading-6 text-zinc-400">{template.description}</p>
                        <p className="mt-3 text-xs leading-6 text-zinc-500">{template.prompt}</p>
                      </button>
                    ))}
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleCreateTask}
                      disabled={isCreating}
                      className="btn-deploy-gradient rounded-full px-5 py-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {isCreating ? 'Creating worker...' : 'Create worker task'}
                    </button>
                    <p className="text-sm text-zinc-500">
                      Supported today: price tracking, jobs, news digests, website monitoring, and page-change alerts.
                    </p>
                  </div>
                </article>

                <article className="rounded-[28px] border border-white/8 bg-[#0d0d0f] p-5 md:p-6">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-red-100">Worker queue</p>
                      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Active and saved tasks</h2>
                    </div>
                    <p className="text-sm text-zinc-500">{dashboard?.tasks.length || 0} tasks</p>
                  </div>

                  <div className="mt-5 space-y-3">
                    {(dashboard?.tasks || []).length === 0 ? (
                      <div className="rounded-[24px] border border-dashed border-white/10 bg-[#08080a] px-5 py-8 text-sm leading-7 text-zinc-500">
                        No worker tasks yet. Create the first one above and SwiftDeploy will run it immediately.
                      </div>
                    ) : (
                      dashboard?.tasks.map((task) => (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => setSelectedTaskId(task.id)}
                          className={`w-full rounded-[24px] border p-5 text-left transition-colors ${
                            selectedTask?.id === task.id
                              ? 'border-red-400/20 bg-red-500/10'
                              : 'border-white/8 bg-[#08080a] hover:border-white/14'
                          }`}
                        >
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-lg font-semibold text-white">{task.title}</p>
                                <span className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] ${badgeClasses[task.runStatus]}`}>
                                  {task.runStatus}
                                </span>
                                <span className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] ${
                                  task.status === 'ACTIVE'
                                    ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100'
                                    : 'border-zinc-500/20 bg-zinc-500/10 text-zinc-300'
                                }`}>
                                  {task.status}
                                </span>
                              </div>
                              <p className="mt-2 text-sm leading-7 text-zinc-400">{task.taskDescription}</p>
                              <div className="mt-4 flex flex-wrap gap-2 text-xs text-zinc-400">
                                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">{task.structuredInstructions.website}</span>
                                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">{scheduleLabel(task.schedule)}</span>
                                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">{task.structuredInstructions.deliveryChannel}</span>
                                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">{task.structuredInstructions.taskType.replace(/_/g, ' ')}</span>
                                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
                                  {task.structuredInstructions.steps?.length ? `${task.structuredInstructions.steps.length} workflow steps` : 'Legacy extractor'}
                                </span>
                              </div>
                              {task.lastSummary ? (
                                <p className="mt-4 text-sm leading-7 text-zinc-300">{task.lastSummary}</p>
                              ) : null}
                            </div>

                            <div className="flex flex-wrap gap-2 lg:justify-end">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleTaskAction(task.id, 'run', task);
                                }}
                                disabled={actionTaskId === task.id}
                                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-200 transition-colors hover:border-white/20 hover:bg-white/[0.06]"
                              >
                                {actionTaskId === task.id ? 'Running...' : 'Run now'}
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleTaskAction(task.id, 'toggle', task);
                                }}
                                disabled={actionTaskId === task.id}
                                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-200 transition-colors hover:border-white/20 hover:bg-white/[0.06]"
                              >
                                {task.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleTaskAction(task.id, 'delete', task);
                                }}
                                disabled={actionTaskId === task.id}
                                className="rounded-full border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-100 transition-colors hover:bg-red-500/15"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </article>
              </section>

              <section className="space-y-6">
                <article className="rounded-[28px] border border-white/8 bg-[#0d0d0f] p-5 md:p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-red-100">Selected task</p>
                      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                        {selectedTask ? selectedTask.title : 'Choose a worker task'}
                      </h2>
                    </div>
                    {selectedTask ? (
                      <button
                        type="button"
                        onClick={() => void handleTaskAction(selectedTask.id, 'run', selectedTask)}
                        disabled={actionTaskId === selectedTask.id}
                        className="btn-deploy-gradient rounded-full px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {actionTaskId === selectedTask.id ? 'Running...' : 'Run task'}
                      </button>
                    ) : null}
                  </div>

                  {selectedTask ? (
                    <>
                      <div className="mt-5 grid gap-3 sm:grid-cols-2">
                        {[
                          ['Website', selectedTask.structuredInstructions.website],
                          ['Keyword', selectedTask.structuredInstructions.keyword || 'None'],
                          ['Schedule', scheduleLabel(selectedTask.schedule)],
                          ['Delivery', selectedTask.structuredInstructions.deliveryChannel],
                          ['Workflow', selectedTask.structuredInstructions.steps?.length ? `${selectedTask.structuredInstructions.steps.length} steps` : 'Legacy extractor'],
                          ['Next run', formatRelativeLabel(selectedTask.nextRunAt)],
                          ['Last success', formatRelativeLabel(selectedTask.lastSuccessfulRunAt)]
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-[22px] border border-white/8 bg-[#08080a] px-4 py-4">
                            <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">{label}</p>
                            <p className="mt-2 text-sm text-white">{value}</p>
                          </div>
                        ))}
                      </div>

                      <div className="mt-5 grid gap-3 md:grid-cols-3">
                        <div className="rounded-[22px] border border-white/8 bg-[#08080a] px-4 py-4">
                          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Success rate</p>
                          <p className="mt-2 text-lg font-semibold text-white">{formatPercent(selectedTaskSuccessRate)}</p>
                          <p className="mt-1 text-xs text-zinc-500">{selectedTask.successCount} of {selectedTask.runCount} runs succeeded</p>
                        </div>
                        <div className="rounded-[22px] border border-white/8 bg-[#08080a] px-4 py-4">
                          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Repairs learned</p>
                          <p className="mt-2 text-lg font-semibold text-white">{selectedTask.repairCount}</p>
                          <p className="mt-1 text-xs text-zinc-500">Automatic selector recoveries saved for reuse</p>
                        </div>
                        <div className="rounded-[22px] border border-white/8 bg-[#08080a] px-4 py-4">
                          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Changes detected</p>
                          <p className="mt-2 text-lg font-semibold text-white">{selectedTaskChangeCount}</p>
                          <p className="mt-1 text-xs text-zinc-500">Recent runs that triggered a material update</p>
                        </div>
                      </div>

                      {selectedTaskPriceSeries.length >= 2 ? (
                        <div className="mt-5 rounded-[24px] border border-white/8 bg-[#08080a] p-4">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Price history</p>
                              <p className="mt-2 text-sm text-zinc-300">Recent successful price captures for this task.</p>
                            </div>
                            <p className="text-xs text-zinc-500">{selectedTaskPriceSeries.length} data points</p>
                          </div>
                          <div className="mt-4 flex h-28 items-end gap-2">
                            {selectedTaskPriceSeries.map((point) => {
                              const ratio = selectedTaskPriceBounds.max === selectedTaskPriceBounds.min
                                ? 1
                                : (point.value - selectedTaskPriceBounds.min) / (selectedTaskPriceBounds.max - selectedTaskPriceBounds.min);
                              const height = 24 + Math.round(ratio * 72);
                              return (
                                <div key={point.id} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                                  <div
                                    className="w-full rounded-t-[10px] bg-gradient-to-t from-red-500/85 to-red-300/70"
                                    style={{ height }}
                                    title={point.value.toFixed(2)}
                                  />
                                  <span className="text-[10px] text-zinc-500">{Math.round(point.value)}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

                      <div className="mt-5 rounded-[24px] border border-white/8 bg-[#08080a] p-4">
                        <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Structured instructions</p>
                        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs leading-6 text-zinc-300">
                          {JSON.stringify(selectedTask.structuredInstructions, null, 2)}
                        </pre>
                      </div>

                      {selectedTask.structuredInstructions.steps?.length ? (
                        <div className="mt-5 rounded-[24px] border border-white/8 bg-[#08080a] p-4">
                          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Workflow steps</p>
                          <div className="mt-4 space-y-3">
                            {selectedTask.structuredInstructions.steps.map((step, index) => (
                              <div
                                key={`${step.action}-${index}`}
                                className="flex items-start gap-3 rounded-[20px] border border-white/8 bg-[#050507] px-4 py-3"
                              >
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-400/20 bg-red-500/10 text-xs font-semibold text-red-100">
                                  {index + 1}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-white">{step.label || step.action}</p>
                                  <p className="mt-1 text-xs leading-6 text-zinc-400">
                                    {[ 
                                      step.action,
                                      step.storeAs ? `stores ${step.storeAs}` : '',
                                      step.selector || step.selectors?.[0] || step.url || ''
                                    ]
                                      .filter(Boolean)
                                      .join(' / ')}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="mt-5 rounded-[24px] border border-dashed border-white/10 bg-[#08080a] px-4 py-8 text-sm leading-7 text-zinc-500">
                      Select a task from the queue to inspect its schedule, structured instructions, result history, and repair logs.
                    </div>
                  )}
                </article>

                <article className="rounded-[28px] border border-white/8 bg-[#0d0d0f] p-5 md:p-6">
                  <p className="text-sm font-medium text-red-100">Result history</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Latest runs</h2>
                  <div className="mt-5 space-y-3">
                    {selectedTaskResults.length === 0 ? (
                      <div className="rounded-[24px] border border-dashed border-white/10 bg-[#08080a] px-4 py-7 text-sm leading-7 text-zinc-500">
                        No runs recorded yet for this task.
                      </div>
                    ) : (
                      selectedTaskResults.map((result: WorkerTaskResult) => (
                        <div key={result.id} className="rounded-[24px] border border-white/8 bg-[#08080a] p-4">
                          <div className="flex items-center justify-between gap-3">
                            <span className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] ${
                              result.status === 'SUCCESS'
                                ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100'
                                : 'border-red-400/20 bg-red-500/10 text-red-100'
                            }`}>
                              {result.status}
                            </span>
                            <p className="text-xs text-zinc-500">{formatRelativeLabel(result.createdAt)}</p>
                          </div>
                          <p className="mt-3 text-sm leading-7 text-zinc-200">{result.summary}</p>
                          {result.detectedChange ? (
                            <p className="mt-3 text-xs text-red-200">Change detected on this run.</p>
                          ) : null}
                          {getResultHighlights(result).length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {getResultHighlights(result).map((highlight) => (
                                <span
                                  key={highlight}
                                  className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-300"
                                >
                                  {highlight}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </article>

                <article className="rounded-[28px] border border-white/8 bg-[#0d0d0f] p-5 md:p-6">
                  <p className="text-sm font-medium text-red-100">Execution log</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Run and repair events</h2>
                  <div className="mt-5 space-y-3">
                    {selectedTaskLogs.length === 0 ? (
                      <div className="rounded-[24px] border border-dashed border-white/10 bg-[#08080a] px-4 py-7 text-sm leading-7 text-zinc-500">
                        Logs will appear here after the first run.
                      </div>
                    ) : (
                      selectedTaskLogs.map((log: WorkerExecutionLog) => (
                        <div key={log.id} className="rounded-[24px] border border-white/8 bg-[#08080a] p-4">
                          <div className="flex items-center justify-between gap-3">
                            <span className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] ${
                              log.level === 'SUCCESS'
                                ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100'
                                : log.level === 'ERROR'
                                  ? 'border-red-400/20 bg-red-500/10 text-red-100'
                                  : log.level === 'REPAIR'
                                    ? 'border-cyan-400/20 bg-cyan-500/10 text-cyan-100'
                                    : 'border-white/10 bg-white/[0.03] text-zinc-300'
                            }`}>
                              {log.level}
                            </span>
                            <p className="text-xs text-zinc-500">{formatRelativeLabel(log.timestamp)}</p>
                          </div>
                          <p className="mt-3 text-sm leading-7 text-zinc-200">{log.message}</p>
                          {log.metadata && Object.keys(log.metadata).length > 0 ? (
                            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs leading-6 text-zinc-500">
                              {JSON.stringify(log.metadata, null, 2)}
                            </pre>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </article>
              </section>
            </div>
          </div>
        )}
      </WorkspaceShell>
    </>
  );
};

export default InternetWorkerDashboard;
