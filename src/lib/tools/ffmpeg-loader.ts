import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const CORE_VERSION = "0.12.10";
const CORE_BASE_URL = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

let ffmpeg: FFmpeg | null = null;
let loadPromise: Promise<void> | null = null;

/**
 * Validate a file is under the 100 MB size limit.
 */
export function validateVideoFileSize(file: File): void {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is 100 MB.`,
    );
  }
}

/**
 * Lazy-load FFmpeg.wasm (single-threaded UMD core).
 * Returns the singleton instance.
 *
 * Note: the multi-threaded @ffmpeg/core-mt build deadlocks in many browsers
 * due to emscripten pthread issues, so we use single-threaded and compensate
 * with aggressive encoding flag optimizations instead.
 */
export async function getFFmpeg(
  onProgress?: (progress: number) => void,
): Promise<FFmpeg> {
  if (ffmpeg && ffmpeg.loaded) return ffmpeg;

  if (!loadPromise) {
    ffmpeg = new FFmpeg();

    if (onProgress) {
      ffmpeg.on("progress", ({ progress }) => {
        onProgress(Math.min(Math.round(progress * 100), 100));
      });
    }

    ffmpeg.on("log", ({ message }) => {
      // eslint-disable-next-line no-console
      console.log("[ffmpeg]", message);
    });

    loadPromise = (async () => {
      try {
        await ffmpeg!.load({
          coreURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, "text/javascript"),
          wasmURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, "application/wasm"),
        });
      } catch (err) {
        ffmpeg = null;
        loadPromise = null;
        throw err;
      }
    })();
  }

  await loadPromise;
  return ffmpeg!;
}

/**
 * Read a File into a Uint8Array for writing to FFmpeg's virtual FS.
 */
export async function fileToUint8Array(file: File): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer);
}
