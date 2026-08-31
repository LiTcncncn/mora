import "server-only";

/**
 * 进程内串行写队列。同一逻辑文件的写操作永远不会并发执行，
 * 避免同进程并发写坏本地 JSON。
 */
const queues = new Map<string, Promise<unknown>>();

export function enqueueWrite<T>(
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(task, task);
  queues.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}
