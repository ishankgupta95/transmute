import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  WorkerPool,
  poolSize,
  memoryBudgetBytes,
  DEFAULT_MAX_WORKERS,
  type PoolWorkerRequest,
  type PoolWorkerResponse,
} from "@/lib/workers/pool";

/**
 * A controllable stand-in for a module worker. Tests drive completion by
 * calling `finish` / `fail` / `progress` on the message the pool posted.
 */
class FakeWorker {
  posted: { data: PoolWorkerRequest; transfer: Transferable[] }[] = [];
  terminated = false;
  private listeners = new Map<string, Set<(event: unknown) => void>>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(data: PoolWorkerRequest, transfer: Transferable[] = []): void {
    this.posted.push({ data, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(response: PoolWorkerResponse): void {
    for (const l of this.listeners.get("message") ?? []) l({ data: response });
  }

  emitError(message: string): void {
    for (const l of this.listeners.get("error") ?? []) l({ message });
  }

  get lastTaskId(): number {
    return this.posted[this.posted.length - 1].data.id;
  }
}

function makePool(opts: { maxWorkers?: number; budgetBytes?: number } = {}) {
  const workers: FakeWorker[] = [];
  const pool = new WorkerPool({
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as Worker;
    },
    maxWorkers: opts.maxWorkers ?? DEFAULT_MAX_WORKERS,
    budgetBytes: opts.budgetBytes ?? Number.MAX_SAFE_INTEGER,
  });
  return { pool, workers };
}

const hcSpy = (value: number | undefined) =>
  vi
    .spyOn(navigator, "hardwareConcurrency", "get")
    .mockReturnValue(value as number);

describe("poolSize", () => {
  afterEach(() => vi.restoreAllMocks());

  it("leaves one core for the main thread", () => {
    hcSpy(4);
    expect(poolSize()).toBe(3);
  });

  it("caps at maxWorkers on big machines", () => {
    hcSpy(16);
    expect(poolSize(4)).toBe(4);
  });

  it("floors at 1 on single-core devices", () => {
    hcSpy(1);
    expect(poolSize()).toBe(1);
  });

  it("assumes a small machine when hardwareConcurrency is missing", () => {
    hcSpy(undefined);
    expect(poolSize()).toBe(1);
  });
});

describe("memoryBudgetBytes", () => {
  it("defaults to a quarter of 4 GB when deviceMemory is unavailable", () => {
    // jsdom's navigator has no deviceMemory — the Safari case.
    expect(memoryBudgetBytes()).toBe(1024 ** 3);
  });
});

describe("WorkerPool", () => {
  beforeEach(() => {
    // Deterministic pool size for the scheduling tests: 8 cores → 4 workers.
    hcSpy(8);
  });

  afterEach(() => vi.restoreAllMocks());

  it("runs a task and resolves with the worker's result", async () => {
    const { pool, workers } = makePool();
    const promise = pool.run<string>({ job: "a" });

    expect(workers).toHaveLength(1);
    expect(workers[0].posted[0].data.payload).toEqual({ job: "a" });

    workers[0].emit({ id: workers[0].lastTaskId, type: "done", result: "ok" });
    await expect(promise).resolves.toBe("ok");
  });

  it("passes transferables through postMessage", () => {
    const { pool, workers } = makePool();
    const buf = new ArrayBuffer(8);
    void pool.run({ buf }, { transfer: [buf] });
    expect(workers[0].posted[0].transfer).toEqual([buf]);
  });

  it("runs tasks concurrently up to the pool size, then queues", () => {
    const { pool, workers } = makePool({ maxWorkers: 2 });
    void pool.run({});
    void pool.run({});
    void pool.run({});

    // Two workers spawned, third task queued.
    expect(workers).toHaveLength(2);
    expect(pool.busy).toBe(2);

    workers[0].emit({ id: workers[0].lastTaskId, type: "done", result: 1 });
    // Queued task dispatched onto the freed worker — no third worker.
    expect(workers).toHaveLength(2);
    expect(workers[0].posted).toHaveLength(2);
  });

  it("reuses idle workers instead of spawning new ones", async () => {
    const { pool, workers } = makePool();
    const first = pool.run({});
    workers[0].emit({ id: workers[0].lastTaskId, type: "done", result: null });
    await first;

    void pool.run({});
    expect(workers).toHaveLength(1);
    expect(workers[0].posted).toHaveLength(2);
  });

  it("routes progress messages to the right task", () => {
    const { pool, workers } = makePool({ maxWorkers: 2 });
    const progressA = vi.fn();
    const progressB = vi.fn();
    void pool.run({}, { onProgress: progressA });
    void pool.run({}, { onProgress: progressB });

    workers[1].emit({ id: workers[1].lastTaskId, type: "progress", value: 40 });
    expect(progressA).not.toHaveBeenCalled();
    expect(progressB).toHaveBeenCalledWith(40);
  });

  it("rejects when the worker reports an error, and keeps the worker", async () => {
    const { pool, workers } = makePool();
    const promise = pool.run({});
    workers[0].emit({
      id: workers[0].lastTaskId,
      type: "error",
      message: "decode failed",
    });
    await expect(promise).rejects.toThrow("decode failed");

    // The worker survives a task-level error and takes the next task.
    void pool.run({});
    expect(workers).toHaveLength(1);
    expect(workers[0].posted).toHaveLength(2);
  });

  it("drops the worker and rejects on a top-level worker crash", async () => {
    const { pool, workers } = makePool();
    const promise = pool.run({});
    workers[0].emitError("script blew up");
    await expect(promise).rejects.toThrow("script blew up");
    expect(workers[0].terminated).toBe(true);

    // Next task gets a fresh worker.
    void pool.run({});
    expect(workers).toHaveLength(2);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const { pool, workers } = makePool();
    const controller = new AbortController();
    controller.abort();
    await expect(pool.run({}, { signal: controller.signal })).rejects.toThrow(
      "aborted",
    );
    expect(workers).toHaveLength(0);
  });

  it("aborting a queued task removes it without touching workers", async () => {
    const { pool, workers } = makePool({ maxWorkers: 1 });
    void pool.run({});
    const controller = new AbortController();
    const queued = pool.run({}, { signal: controller.signal });

    controller.abort();
    await expect(queued).rejects.toThrow("aborted");
    expect(workers).toHaveLength(1);
    expect(workers[0].terminated).toBe(false);
    expect(workers[0].posted).toHaveLength(1);
  });

  it("aborting a running task terminates its worker and starts the next", async () => {
    const { pool, workers } = makePool({ maxWorkers: 1 });
    const controller = new AbortController();
    const running = pool.run({}, { signal: controller.signal });
    const queuedNext = pool.run({});

    controller.abort();
    await expect(running).rejects.toThrow("aborted");
    expect(workers[0].terminated).toBe(true);

    // The queued task got a replacement worker.
    expect(workers).toHaveLength(2);
    expect(workers[1].posted).toHaveLength(1);

    workers[1].emit({ id: workers[1].lastTaskId, type: "done", result: "next" });
    await expect(queuedNext).resolves.toBe("next");
  });

  it("holds a task back while in-flight memory would exceed the budget", () => {
    const { pool, workers } = makePool({ maxWorkers: 4, budgetBytes: 100 });
    void pool.run({}, { memoryBytes: 60 });
    void pool.run({}, { memoryBytes: 60 });

    // Second task would put the pool at 120/100 — it must wait.
    expect(workers).toHaveLength(1);
    expect(pool.busy).toBe(1);

    workers[0].emit({ id: workers[0].lastTaskId, type: "done", result: null });
    // Memory released — the held task dispatches.
    expect(pool.busy).toBe(1);
  });

  it("a task bigger than the whole budget still runs — alone", async () => {
    const { pool, workers } = makePool({ maxWorkers: 4, budgetBytes: 100 });
    const huge = pool.run({}, { memoryBytes: 500 });
    expect(pool.busy).toBe(1);

    // Nothing else is admitted while it runs.
    void pool.run({}, { memoryBytes: 10 });
    expect(pool.busy).toBe(1);

    workers[0].emit({ id: workers[0].lastTaskId, type: "done", result: "big" });
    await expect(huge).resolves.toBe("big");
    expect(pool.busy).toBe(1); // the small task started
  });

  it("keeps FIFO order — a large head-of-line task is not overtaken", () => {
    const { pool, workers } = makePool({ maxWorkers: 4, budgetBytes: 100 });
    void pool.run({ n: 1 }, { memoryBytes: 60 });
    void pool.run({ n: 2 }, { memoryBytes: 60 }); // blocked on memory
    void pool.run({ n: 3 }, { memoryBytes: 1 }); // must NOT jump the queue

    expect(pool.busy).toBe(1);
    expect(workers[0].posted[0].data.payload).toEqual({ n: 1 });
  });

  it("destroy terminates workers and rejects queued and running tasks", async () => {
    const { pool, workers } = makePool({ maxWorkers: 1 });
    const running = pool.run({});
    const queued = pool.run({});

    pool.destroy();
    await expect(running).rejects.toThrow("aborted");
    await expect(queued).rejects.toThrow("aborted");
    expect(workers[0].terminated).toBe(true);
    await expect(pool.run({})).rejects.toThrow("destroyed");
  });

  it("exposes size derived from hardwareConcurrency", () => {
    const { pool } = makePool({ maxWorkers: 4 });
    expect(pool.size).toBe(4); // 8 cores mocked → clamp(7, 1, 4)
  });
});
