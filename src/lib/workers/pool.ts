import { abortError } from "@/lib/utils/abort";

/**
 * Plain Web Worker task pool — the Phase 3 primitive.
 *
 * Owner decision (plan.md, 2026-08-09): multi-core means a pool of ordinary
 * module workers, one task per worker, nothing shared. No SharedArrayBuffer,
 * no multi-threaded WASM builds. FFmpeg is explicitly NOT behind this pool —
 * it stays the serialised single-threaded singleton in ffmpeg-loader.ts.
 *
 * The pool solves two problems at once:
 *  - parallelism across files (a batch of N images uses up to N workers), and
 *  - keeping heavy encode work off the main thread even for a single file.
 *
 * Admission control is memory-aware: every task declares an estimated peak
 * footprint (`memoryBytes`), and the pool refuses to *start* a task while the
 * in-flight total would exceed the device budget — eight concurrent 40 MB
 * decodes must not OOM mobile Safari. A task bigger than the whole budget
 * still runs, just alone; degrading to sequential is the correct worst case.
 */

/** Hard ceiling on workers per pool, whatever the hardware claims. */
export const DEFAULT_MAX_WORKERS = 4;

/**
 * Worker count: one core is always left for the main thread (the UI must stay
 * responsive during a batch — that's the phase gate), floored at 1 so
 * single-core devices still work, ceilinged so a 24-core desktop doesn't
 * spawn 23 copies of a WASM heap.
 */
export function poolSize(maxWorkers: number = DEFAULT_MAX_WORKERS): number {
  const hc =
    typeof navigator !== "undefined" ? (navigator.hardwareConcurrency ?? 2) : 2;
  return Math.max(1, Math.min(hc - 1, maxWorkers));
}

/**
 * Bytes of decoded/encoded data the pool may hold in flight at once.
 * `navigator.deviceMemory` is Chromium-only (and capped at 8), so its absence
 * (Safari, Firefox) falls back to a conservative 4 GB assumption; a quarter of
 * device memory is a defensible share for a browser tab doing file work.
 */
export function memoryBudgetBytes(): number {
  const gb =
    typeof navigator !== "undefined"
      ? ((navigator as { deviceMemory?: number }).deviceMemory ?? 4)
      : 4;
  return (gb * 1024 ** 3) / 4;
}

export interface PoolRunOptions {
  /** Transferables inside the payload — moved to the worker, not copied. */
  transfer?: Transferable[];
  /**
   * Estimated peak bytes this task pins while running (decoded pixels +
   * encode output). 0 (default) means "negligible" and is always admitted.
   */
  memoryBytes?: number;
  signal?: AbortSignal;
  /** 0–100, forwarded from the worker's progress messages. */
  onProgress?: (progress: number) => void;
}

export interface WorkerPoolOptions {
  /** Creates one pool worker. Called lazily, at most `size` times. */
  createWorker: () => Worker;
  /** Hard ceiling on workers for this pool. Default 4. */
  maxWorkers?: number;
  /** Override the memory budget (tests). Default: memoryBudgetBytes(). */
  budgetBytes?: number;
}

/** What a pool worker posts back. `id` echoes the dispatched task. */
export type PoolWorkerResponse =
  | { id: number; type: "progress"; value: number }
  | { id: number; type: "done"; result: unknown }
  | { id: number; type: "error"; message: string };

/** What a pool worker receives. */
export interface PoolWorkerRequest {
  id: number;
  payload: unknown;
}

interface TaskRecord {
  id: number;
  payload: unknown;
  options: PoolRunOptions;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  onAbort?: () => void;
}

interface WorkerSlot {
  worker: Worker;
  running: TaskRecord | null;
}

export class WorkerPool {
  /** Maximum concurrent workers — the honest "N THREADS" number for the UI. */
  readonly size: number;

  private readonly createWorker: () => Worker;
  private readonly budget: number;
  private slots: WorkerSlot[] = [];
  private queue: TaskRecord[] = [];
  private nextId = 1;
  private inFlightBytes = 0;
  private destroyed = false;

  constructor(options: WorkerPoolOptions) {
    this.createWorker = options.createWorker;
    this.size = poolSize(options.maxWorkers ?? DEFAULT_MAX_WORKERS);
    this.budget = options.budgetBytes ?? memoryBudgetBytes();
  }

  /** Tasks currently executing — for queue headers ("WORKER POOL 2/4"). */
  get busy(): number {
    return this.slots.filter((s) => s.running !== null).length;
  }

  run<TResult>(payload: unknown, options: PoolRunOptions = {}): Promise<TResult> {
    if (this.destroyed) {
      return Promise.reject(new Error("Worker pool has been destroyed"));
    }
    if (options.signal?.aborted) {
      return Promise.reject(abortError());
    }

    return new Promise<TResult>((resolve, reject) => {
      const task: TaskRecord = {
        id: this.nextId++,
        payload,
        options,
        resolve: resolve as (value: unknown) => void,
        reject,
      };

      if (options.signal) {
        const onAbort = () => this.abortTask(task);
        task.onAbort = onAbort;
        options.signal.addEventListener("abort", onAbort, { once: true });
      }

      this.queue.push(task);
      this.pump();
    });
  }

  /** Terminate every worker and reject everything queued or running. */
  destroy(): void {
    this.destroyed = true;
    for (const slot of this.slots) {
      slot.worker.terminate();
      if (slot.running) this.settle(slot.running, "reject", abortError());
    }
    this.slots = [];
    for (const task of this.queue.splice(0)) {
      this.settle(task, "reject", abortError());
    }
    this.inFlightBytes = 0;
  }

  // ── internals ──────────────────────────────────────────────────

  /** Start queued tasks while a worker slot and the memory budget allow. */
  private pump(): void {
    while (this.queue.length > 0) {
      const task = this.queue[0];
      const bytes = task.options.memoryBytes ?? 0;
      const anyRunning = this.slots.some((s) => s.running !== null);
      // Over-budget tasks run alone rather than never.
      if (anyRunning && this.inFlightBytes + bytes > this.budget) return;

      const slot = this.idleSlot();
      if (!slot) return;

      this.queue.shift();
      slot.running = task;
      this.inFlightBytes += bytes;
      slot.worker.postMessage(
        { id: task.id, payload: task.payload } satisfies PoolWorkerRequest,
        task.options.transfer ?? [],
      );
    }
  }

  private idleSlot(): WorkerSlot | null {
    const idle = this.slots.find((s) => s.running === null);
    if (idle) return idle;
    if (this.slots.length >= this.size) return null;

    const worker = this.createWorker();
    const slot: WorkerSlot = { worker, running: null };

    worker.addEventListener("message", (event: MessageEvent) => {
      this.onWorkerMessage(slot, event.data as PoolWorkerResponse);
    });
    // A top-level worker failure (script threw outside a task handler, failed
    // to load) leaves the worker in an unknown state: fail the running task
    // and drop the worker — a replacement is created lazily on next dispatch.
    worker.addEventListener("error", (event: ErrorEvent) => {
      this.dropSlot(slot, new Error(event.message || "Worker crashed"));
    });
    worker.addEventListener("messageerror", () => {
      this.dropSlot(slot, new Error("Worker message could not be deserialized"));
    });

    this.slots.push(slot);
    return slot;
  }

  private onWorkerMessage(slot: WorkerSlot, msg: PoolWorkerResponse): void {
    const task = slot.running;
    if (!task || msg.id !== task.id) return; // late message from an aborted task

    if (msg.type === "progress") {
      task.options.onProgress?.(msg.value);
      return;
    }

    slot.running = null;
    this.inFlightBytes -= task.options.memoryBytes ?? 0;
    if (msg.type === "done") {
      this.settle(task, "resolve", msg.result);
    } else {
      this.settle(task, "reject", new Error(msg.message));
    }
    this.pump();
  }

  /**
   * Abort: a queued task just leaves the queue; a running task's worker is
   * terminated — the only way to stop synchronous WASM/encode work — and the
   * slot is dropped, to be replaced lazily.
   */
  private abortTask(task: TaskRecord): void {
    const queued = this.queue.indexOf(task);
    if (queued !== -1) {
      this.queue.splice(queued, 1);
      this.settle(task, "reject", abortError());
      return;
    }

    const slot = this.slots.find((s) => s.running === task);
    if (!slot) return; // already settled
    slot.worker.terminate();
    this.slots.splice(this.slots.indexOf(slot), 1);
    slot.running = null;
    this.inFlightBytes -= task.options.memoryBytes ?? 0;
    this.settle(task, "reject", abortError());
    this.pump();
  }

  private dropSlot(slot: WorkerSlot, error: Error): void {
    const task = slot.running;
    slot.worker.terminate();
    const idx = this.slots.indexOf(slot);
    if (idx !== -1) this.slots.splice(idx, 1);
    if (task) {
      slot.running = null;
      this.inFlightBytes -= task.options.memoryBytes ?? 0;
      this.settle(task, "reject", error);
    }
    this.pump();
  }

  private settle(task: TaskRecord, how: "resolve" | "reject", value: unknown): void {
    if (task.onAbort) {
      task.options.signal?.removeEventListener("abort", task.onAbort);
      task.onAbort = undefined;
    }
    if (how === "resolve") task.resolve(value);
    else task.reject(value);
  }
}
