/**
 * Message shapes shared by audio-client.ts (main thread) and
 * audio-encode.worker.ts. Types only.
 */

export type AudioEncodeJob =
  | {
      op: "mp3";
      /** One ArrayBuffer of Float32 samples per channel. Transferred. */
      channels: ArrayBuffer[];
      sampleRate: number;
      bitrate: number;
    }
  | {
      op: "wav";
      channels: ArrayBuffer[];
      sampleRate: number;
    };

export interface AudioEncodeResult {
  /** Encoded output. Transferred back. */
  bytes: ArrayBuffer;
  mime: string;
}
