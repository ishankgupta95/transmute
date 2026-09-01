/// <reference lib="webworker" />
import { encodePcmToMp3, encodePcmToWav } from "@/lib/tools/audio-pcm";
import type { PoolWorkerRequest, PoolWorkerResponse } from "./pool";
import type { AudioEncodeJob, AudioEncodeResult } from "./audio-protocol";

/**
 * Pool worker for audio encoding — the CPU-bound tail of every audio tool.
 * Decoding cannot happen here (AudioContext/OfflineAudioContext don't exist
 * in workers), so the main thread decodes and ships raw Float32 channel data
 * across; lamejs and the WAV interleave loop grind off the main thread.
 *
 * Import ONLY audio-pcm.ts here. The audio-encode-mp3/wav wrappers reach
 * back into audio-client (which names this worker's URL) — importing them
 * would put this worker inside its own bundle graph, which hangs the
 * production build's chunker.
 *
 * lamejs is not bundled into this file: audio-pcm.ts fetches it from
 * `/vendor/lamejs.js` at first MP3 encode, which is why the mp3 branch below
 * is awaited. That works here only because audio-client.ts constructs this
 * worker as a same-origin `{ type: "module" }` script — a classic worker has
 * no `import()`, and a blob: worker has no base to resolve `/vendor/…`
 * against.
 */

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (event: MessageEvent<PoolWorkerRequest>) => {
  const { id, payload } = event.data;
  const job = payload as AudioEncodeJob;

  try {
    const channels = job.channels.map((buf) => new Float32Array(buf));
    const blob =
      job.op === "mp3"
        ? await encodePcmToMp3(channels, job.sampleRate, job.bitrate, (value) =>
            self.postMessage({
              id,
              type: "progress",
              value,
            } satisfies PoolWorkerResponse),
          )
        : encodePcmToWav(channels, job.sampleRate);

    const bytes = await blob.arrayBuffer();
    const result: AudioEncodeResult = { bytes, mime: blob.type };
    self.postMessage({ id, type: "done", result } satisfies PoolWorkerResponse, [
      bytes,
    ]);
  } catch (err) {
    self.postMessage({
      id,
      type: "error",
      message: err instanceof Error ? err.message : "Audio encoding failed",
    } satisfies PoolWorkerResponse);
  }
};
