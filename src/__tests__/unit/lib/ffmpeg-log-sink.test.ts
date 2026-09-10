/**
 * The scoped FFmpeg log sink, which is the only reason `normalize-audio` can
 * run two passes.
 *
 * `loudnorm:print_format=json` writes its measurement to FFmpeg's stderr and
 * nowhere else — there is no output file to read it out of, the way
 * `ffprobe -o` gives the probe a MEMFS file. Before this sink existed the
 * loader's single `on("log")` handler wrote to `console.log` in development
 * and dropped the line in production, so those numbers were unreachable and
 * a second pass could not be built.
 *
 * This file lives apart from `ffmpeg-loader.test.ts` because it has to mock
 * `@ffmpeg/ffmpeg` with a constructor that CAPTURES the listener rather than
 * ignoring it, and the count of captured listeners is itself an assertion.
 *
 * What it pins, and why each one is a real failure mode rather than a
 * restatement of the code:
 *
 *  - lines reach the task that asked for them, IN ORDER, including the
 *    trailing `Aborted()` that every `-f null -` run emits (measured
 *    2026-09-05: benign, exit 0, JSON still present). A parser that stops at
 *    the first unexpected line would drop the stats object;
 *  - a LATER task that passed no `onLog` cannot reach an earlier task's
 *    callback. The slot is released in a `finally` under an identity guard,
 *    the same shape `currentOnProgress` uses;
 *  - exactly ONE listener is ever registered on the instance, no matter how
 *    many tasks run. Registering per task would leak a handler per job and
 *    replay every later job's output into every earlier job's parser;
 *  - a task that THROWS still releases the slot.
 *
 * This comment used to end with a rule: the deliberate failure message below
 * must not be "boom", because `OOM_SIGNATURES` matched the bare substring
 * `"oom"` and `describeFFmpegFailure` would rewrite any message containing it
 * into the out-of-memory copy. That rule is REMOVED as of 2026-09-05 — the
 * token is matched on a word boundary now (`OOM_TOKEN`,
 * `src/lib/tools/ffmpeg-loader.ts:151`), which does not fire inside "boom",
 * "zoom", "room" or "bloom", and the bug it was a workaround for is fixed at
 * the source rather than routed around here. The message below is left exactly
 * as it was: nothing this file pins depends on its wording.
 */
import { describe, it, expect, vi } from "vitest";

type LogCb = (e: { type: string; message: string }) => void;
const logCbs: LogCb[] = [];

vi.mock("@ffmpeg/ffmpeg", () => ({
  FFmpeg: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.loaded = false;
    this.load = vi.fn().mockResolvedValue(true);
    this.on = (event: string, cb: LogCb) => {
      if (event === "log") logCbs.push(cb);
    };
    this.terminate = vi.fn();
    this.exec = async () => 0;
  }),
  FFFSType: { WORKERFS: "WORKERFS", MEMFS: "MEMFS" },
}));

vi.mock("@ffmpeg/util", () => ({ toBlobURL: vi.fn().mockResolvedValue("blob:mock") }));

const emit = (message: string) => logCbs.forEach((cb) => cb({ type: "stderr", message }));

describe("ffmpeg-loader scoped log sink", () => {
  it("routes lines to the task that asked, and to nobody after it", async () => {
    const { runFFmpegTask } = await import("@/lib/tools/ffmpeg-loader");

    const seen: string[] = [];
    await runFFmpegTask(
      async () => {
        emit("Duration: 00:00:02.00");
        emit("Aborted()");
      },
      { onLog: (l) => seen.push(l) },
    );

    expect(seen).toEqual(["Duration: 00:00:02.00", "Aborted()"]);
    expect(logCbs.length).toBe(1);

    // A LATER task that did not ask must not reach the first task's callback.
    await runFFmpegTask(async () => {
      emit("a later job's line");
    });
    expect(seen).toEqual(["Duration: 00:00:02.00", "Aborted()"]);

    // Nothing is registered per job — the leak the module comment names.
    expect(logCbs.length).toBe(1);

    // A task that throws still releases the slot.
    await expect(
      runFFmpegTask(
        async () => {
          throw new Error("deliberate failure");
        },
        { onLog: (l) => seen.push(l) },
      ),
    ).rejects.toThrow("deliberate failure");
    emit("after the failure");
    expect(seen).toEqual(["Duration: 00:00:02.00", "Aborted()"]);
  });
});
