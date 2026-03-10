type Task = () => Promise<void> | void;

export type KeyedTaskQueue = {
  enqueue: (key: string, task: Task) => boolean;
  stats: () => { activeKeys: number; queuedTasks: number };
};

export const createKeyedTaskQueue = (options?: {
  maxQueuePerKey?: number;
  onTaskError?: (error: unknown, key: string) => void;
}): KeyedTaskQueue => {
  const maxQueuePerKey = Math.max(1, options?.maxQueuePerKey ?? 100);
  const running = new Set<string>();
  const queues = new Map<string, Task[]>();

  const runNext = (key: string): void => {
    if (running.has(key)) return;
    const queue = queues.get(key);
    if (!queue || queue.length === 0) {
      queues.delete(key);
      return;
    }

    const next = queue.shift()!;
    if (queue.length === 0) {
      queues.delete(key);
    }
    running.add(key);

    Promise.resolve()
      .then(() => next())
      .catch((error) => {
        options?.onTaskError?.(error, key);
      })
      .finally(() => {
        running.delete(key);
        runNext(key);
      });
  };

  return {
    enqueue: (key, task) => {
      const normalizedKey = String(key || "global").trim() || "global";
      const queue = queues.get(normalizedKey) ?? [];
      if (queue.length >= maxQueuePerKey) {
        return false;
      }
      queue.push(task);
      queues.set(normalizedKey, queue);
      runNext(normalizedKey);
      return true;
    },
    stats: () => {
      let queuedTasks = 0;
      for (const queue of queues.values()) queuedTasks += queue.length;
      return {
        activeKeys: running.size,
        queuedTasks,
      };
    },
  };
};
