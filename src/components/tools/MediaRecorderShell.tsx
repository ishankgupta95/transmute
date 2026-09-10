"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { audioMeta, videoMeta, type Dimensions } from "@/lib/utils/canvas-meta";
import { formatFileSize } from "@/lib/utils/file-helpers";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { CanvasHeader, CanvasStage, RecordStage } from "@/components/tools/ToolCanvas";
import { CANVAS_COLUMN, STAGE_GROW, STAGE_MEDIA } from "@/components/workspace/shared";
import { cn } from "@/lib/utils/cn";

/*
  ONE MediaRecorder STATE MACHINE, THREE TOOLS.

  This is `ScreenRecorderUI` with the display-capture specifics lifted out into
  props. Everything here — the status union, the level meter, the two cleanup
  effects, the 1 s timer, the pause/resume pair, the four-branch footer — was
  read out of that file and moved verbatim; `/screen-recorder` renders exactly
  the same DOM through it as it did inline, because its e2e specs pin the
  control labels ("Start Recording", "Stop and save", "Pause", "Resume"), the
  `screen-recording-…webm` download name, and its measured surface height
  (`tool-surface-heights.ts`: sm 634 / md 610) is what stops ~200px of CLS on
  that page.

  What each sibling changes is small and enumerated in the props below: where
  the stream comes from, whether there is a live picture, whether the browser
  has its own "stop sharing" bar, and what a denied permission is called.
*/

type Status = "idle" | "recording" | "paused" | "done" | "error";

export interface MediaRecorderShellProps {
  /**
   * `getDisplayMedia` / `getUserMedia`, already carrying the tool's own
   * constraints. Anything it throws lands in `describeAcquireError`.
   */
  acquireStream: () => Promise<MediaStream>;
  /**
   * Live `<video srcObject>` above the clock. The webcam is the only caller
   * that wants one: a screen recorder previewing the screen it is capturing
   * draws an infinity mirror, and an audio recorder has no picture.
   */
  showPreview: boolean;
  /**
   * No video track at all. The level meter becomes the whole stage, the
   * finished clip plays back through `<audio>`, and the canvas header reads
   * the recorded audio's rate and channel count instead of a frame size.
   */
  audioOnly?: boolean;
  /** "screen-recording" | "webcam-recording" | "audio-recording". */
  fileNamePrefix: string;
  /**
   * Tried in order against `MediaRecorder.isTypeSupported`; the LAST entry is
   * also the fallback when none of them is supported, which is how the screen
   * recorder's original `isTypeSupported(vp9) ? vp9 : "video/webm"` behaved.
   */
  mimeCandidates: readonly string[];
  /**
   * Extension for containers this shell has no mapping for. The download name
   * follows `recorder.mimeType` — what the browser actually chose — wherever
   * that names a container we recognise, so a Safari MP4 is not handed over
   * as `.webm`.
   */
  fileExtension: string;
  /**
   * Rail controls above OUTPUT — device pickers, mic toggles. Rendered only
   * while idle with nothing recorded: none of them can change a capture that
   * is already running, and a picker that looks live but is not is a lie.
   */
  controls?: ReactNode;
  /** Maps a getUserMedia/getDisplayMedia DOMException to this tool's copy. */
  describeAcquireError: (err: unknown) => string;
  /**
   * Screen only: the browser's own "Stop sharing" bar ends the track, and the
   * recording has to end with it. A camera or a microphone has no such bar.
   */
  stopOnTrackEnded?: boolean;
  /** The mono line under the clock. Receives the stream and the chosen mime. */
  metaFor?: (stream: MediaStream, mime: string) => string[];
  /** Empty-state icon, before anything has been recorded. */
  idleIcon: ReactNode;
  /** Empty-state sentence: what pressing the primary button will do. */
  idleHint: string;
  /** The standing sentence under the OUTPUT rows. */
  outputNote: ReactNode;
  /**
   * A second OUTPUT line, shown only once a clip exists, built from the mime
   * MediaRecorder actually used. Optional because the screen recorder's
   * rendered surface is pinned and must not grow a line.
   */
  formatNote?: (mimeType: string) => string;
}

export function MediaRecorderShell({
  acquireStream,
  showPreview,
  audioOnly = false,
  fileNamePrefix,
  mimeCandidates,
  fileExtension,
  controls,
  describeAcquireError,
  stopOnTrackEnded = false,
  metaFor,
  idleIcon,
  idleHint,
  outputNote,
  formatNote,
}: MediaRecorderShellProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<{ blob: Blob; url: string; mimeType: string } | null>(
    null,
  );
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState<number | null>(null);
  const [meta, setMeta] = useState<string[]>([]);
  /* The doc's video readout leads with the frame size. The capture's own
     track settings are the authority here — the played-back WebM declares no
     duration, so the elapsed counter supplies the clip length instead. */
  const [captureDims, setCaptureDims] = useState<Dimensions | null>(null);
  /* Same idea one track over: an audio-only clip's header reads the rate and
     channel count off the live track, because the file itself will not say. */
  const [audioSpec, setAudioSpec] = useState<{ sampleRate: number; channels: number } | null>(null);
  /* Held in state, not just the ref, so the preview element re-renders with a
     stream to bind. Nothing else reads it. */
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  /* Disables the idle primary — and with it the ⌘↵ binding ToolActions gates
     on the same prop — for as long as a device is being opened. The ref below
     is the real guard; this is the half the user can see. */
  const [acquiring, setAcquiring] = useState(false);
  const acquiringRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const meterRef = useRef<{ ctx: AudioContext; raf: number } | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);

  /** Tear down the level meter's AudioContext and its rAF loop. */
  const stopMeter = useCallback(() => {
    const meter = meterRef.current;
    if (!meter) return;
    cancelAnimationFrame(meter.raf);
    void meter.ctx.close();
    meterRef.current = null;
    setLevel(null);
  }, []);

  /**
   * Drive the doc's INPUT LEVEL bar off the real audio track. Purely a display
   * — nothing here touches what MediaRecorder writes.
   */
  const startMeter = useCallback((stream: MediaStream) => {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      const ctx = new Ctor();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      // An audio-only view of the capture: the analyser wants one source, and
      // building it in here keeps a missing `MediaStream` constructor inside
      // the "a meter is decoration" catch instead of failing the recording.
      ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
        setLevel(peak);
        if (meterRef.current) meterRef.current.raf = requestAnimationFrame(tick);
      };
      meterRef.current = { ctx, raf: requestAnimationFrame(tick) };
    } catch {
      // A meter is decoration; recording continues without it.
    }
  }, []);

  // Stop the timer, recorder, and all live tracks if the user navigates away —
  // otherwise the screen-share / camera / mic indicator stays on and recording
  // continues in the background (privacy + resource leak).
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (meterRef.current) {
        cancelAnimationFrame(meterRef.current.raf);
        void meterRef.current.ctx.close();
        meterRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Revoke the recording's object URL when it is replaced or on unmount.
  useEffect(() => {
    const url = recording?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [recording?.url]);

  // Bind the live capture to the preview element. A DOM write, not state: the
  // element only exists while `showPreview` and the capture is running.
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    el.srcObject = liveStream;
    return () => {
      el.srcObject = null;
    };
  }, [liveStream]);

  const startRecording = useCallback(async () => {
    /*
      ONE ENTRANT, AND THE GUARD HAS TO BE A REF.

      `acquireStream` awaits a device opening — 100-500 ms for a microphone,
      up to a couple of seconds for a cold camera — and nothing above the await
      changes `status`, so React does not re-render and the button stays
      enabled, labelled "Start Recording", for that whole window. A second
      press (an ordinary double-click, or the ⌘↵ chord held down, which
      `ToolActions` binds on window with no key-repeat guard) used to run this
      body a second time and orphan everything the first run installed:
      `chunksRef.current` is dereferenced at push time, so BOTH recorders wrote
      into whichever array was newest and the saved clip was two independent
      WebM byte streams interleaved; the first stream's tracks were stopped by
      nobody — `stopRecording`, `handleReset` and the unmount cleanup all read
      the single `streamRef` — so the camera/mic indicator stayed lit through
      "Stop and save"; two intervals ran, so Elapsed counted 2 s per second and
      kept counting after the clip was finished; and a second `AudioContext`
      was opened while the first was never closed.

      A state flag cannot do this: it is not visible until React re-renders,
      which is exactly what the acquire window does not do. The ref is set
      synchronously, before the await, and cleared in the `finally` — by which
      point the primary reads "Stop and save" and this path is unreachable.
    */
    if (acquiringRef.current) return;
    acquiringRef.current = true;
    setAcquiring(true);

    setError(null);
    // Revoke any prior recording's URL before starting a new one.
    if (recording?.url) URL.revokeObjectURL(recording.url);
    setRecording(null);
    setElapsed(0);
    // Defensive: clear any stale timer from a previous failed start.
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    try {
      const stream = await acquireStream();

      streamRef.current = stream;
      setLiveStream(stream);
      chunksRef.current = [];

      const mimeType = pickMimeType(mimeCandidates);

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      // What the browser says it is writing, which need not be what we asked
      // for. Every downstream claim — the blob type, the file extension, the
      // format line in the rail — is read off this and nothing else.
      const actualMime = recorder.mimeType || mimeType;

      const videoTrack = stream.getVideoTracks()[0];
      const settings = videoTrack?.getSettings() ?? {};
      setCaptureDims(
        settings.width && settings.height ? { w: settings.width, h: settings.height } : null,
      );
      const audioSettings = stream.getAudioTracks()[0]?.getSettings() ?? {};
      setAudioSpec(
        audioSettings.sampleRate && audioSettings.channelCount
          ? { sampleRate: audioSettings.sampleRate, channels: audioSettings.channelCount }
          : null,
      );
      setMeta(metaFor ? metaFor(stream, actualMime) : [describeRecordingFormat(actualMime)]);
      if (stream.getAudioTracks().length > 0) startMeter(stream);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: containerOf(actualMime) });
        const url = URL.createObjectURL(blob);
        setRecording({ blob, url, mimeType: actualMime });
        setStatus("done");
        setLiveStream(null);
        stopMeter();

        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      };

      if (stopOnTrackEnded) {
        // Stop when the user ends sharing via the browser's own bar. Only the
        // display-capture path has one; a camera or mic track ending is a
        // device fault, not an instruction, so the siblings do not opt in.
        const endable = videoTrack ?? stream.getTracks()[0];
        endable?.addEventListener("ended", () => {
          if (recorder.state !== "inactive") recorder.stop();
          stopAllTracks(stream);
        });
      }

      recorder.start(1000);
      setStatus("recording");

      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      // Roll back any partial state and stop tracks if a stream was acquired
      // before failure.
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (streamRef.current) {
        stopAllTracks(streamRef.current);
        streamRef.current = null;
      }
      setLiveStream(null);
      stopMeter();
      setError(describeAcquireError(err));
      setStatus("error");
    } finally {
      acquiringRef.current = false;
      setAcquiring(false);
    }
  }, [
    acquireStream,
    describeAcquireError,
    metaFor,
    mimeCandidates,
    recording,
    startMeter,
    stopMeter,
    stopOnTrackEnded,
  ]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      stopAllTracks(streamRef.current);
    }
    stopMeter();
  }, [stopMeter]);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
      setStatus("paused");
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, []);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      setStatus("recording");
      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    }
  }, []);

  const handleReset = useCallback(() => {
    if (recording?.url) URL.revokeObjectURL(recording.url);
    setRecording(null);
    setStatus("idle");
    setError(null);
    setElapsed(0);
  }, [recording]);

  const isLive = status === "recording" || status === "paused";

  return (
    <>
      {/* ── Canvas: the capture, live and then played back ───── */}
      <div className={CANVAS_COLUMN}>
        {status === "idle" && !recording && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-bg-secondary px-6 py-16 text-center">
            {idleIcon}
            <p className="text-sm text-text-secondary">Nothing recorded yet</p>
            <p className="max-w-xs text-xs text-text-muted">{idleHint}</p>
          </div>
        )}

        {isLive && showPreview && (
          /* Bounded the way VideoToGifUI bounds its result: `max-h-full` in an
             auto-height parent resolves to the source's natural size, and a
             1080p camera then paints straight past the canvas band. */
          <CanvasStage className="flex max-h-[clamp(10rem,30vh,24rem)] items-center justify-center bg-black">
            <video
              ref={previewRef}
              autoPlay
              muted
              playsInline
              aria-label="Live camera preview"
              className="max-h-full max-w-full object-contain"
            />
          </CanvasStage>
        )}

        {isLive && (
          <CanvasStage>
            <RecordStage
              elapsed={formatElapsed(elapsed)}
              meta={meta}
              level={level}
              paused={status === "paused"}
            />
          </CanvasStage>
        )}

        {status === "error" && <ErrorMessage message={error} />}

        {status === "done" && recording && (
          <>
            <CanvasHeader
              file="Recording"
              meta={
                audioOnly
                  ? audioMeta(
                      audioSpec,
                      formatElapsed(elapsed),
                      formatFileSize(recording.blob.size),
                    )
                  : videoMeta(
                      captureDims,
                      formatElapsed(elapsed),
                      formatFileSize(recording.blob.size),
                    )
              }
            />
            {audioOnly ? (
              <CanvasStage className="flex items-center justify-center px-4 py-6">
                <audio src={recording.url} controls className="w-full" />
              </CanvasStage>
            ) : (
              <CanvasStage className={cn(STAGE_GROW, "flex items-center justify-center bg-black")}>
                <video src={recording.url} controls className={cn(STAGE_MEDIA, "bg-black")} />
              </CanvasStage>
            )}
          </>
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          isLive ? (
            <>
              {/*
                The doc draws Pause as a bordered 36px button beside the
                primary, not as the quiet mono link this was — it is a real,
                reversible action on the recorder (`MediaRecorder.pause()` /
                `.resume()`), and it deserves a target the size of one.
              */}
              <button
                type="button"
                onClick={status === "recording" ? pauseRecording : resumeRecording}
                className="h-9 w-full cursor-pointer rounded-md border border-border bg-transparent font-display text-[13px] leading-none font-medium text-text-primary transition-colors duration-200 hover:border-accent/40 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {status === "recording" ? "Pause" : "Resume"}
              </button>
              <ToolActions primaryLabel="Stop and save" onPrimary={stopRecording} />
            </>
          ) : status === "done" && recording ? (
            <>
              <DownloadButton
                blob={recording.blob}
                fileName={`${fileNamePrefix}-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.${extensionFor(recording.mimeType, fileExtension)}`}
                className="w-full justify-center"
              />
              <ToolResetLink onClick={handleReset} label="RECORD ANOTHER" />
            </>
          ) : status === "error" ? (
            <ToolActions primaryLabel="Try again" onPrimary={handleReset} />
          ) : (
            <ToolActions
              primaryLabel="Start Recording"
              onPrimary={startRecording}
              primaryDisabled={acquiring}
            />
          )
        }
      >
        {status === "idle" && !recording && controls}

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Status", STATUS_LABEL[status]],
              ["Elapsed", formatElapsed(elapsed)],
              ["Size", recording ? formatFileSize(recording.blob.size) : "—"],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">{outputNote}</span>
          {recording && formatNote && (
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {formatNote(recording.mimeType)}
            </span>
          )}
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}

const STATUS_LABEL: Record<Status, string> = {
  idle: "ready",
  recording: "recording",
  paused: "paused",
  done: "done",
  error: "failed",
};

function stopAllTracks(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * First candidate this browser admits to supporting, else the last one.
 *
 * The fallback is deliberate rather than a failure: the screen recorder's
 * original line was `isTypeSupported(vp9) ? vp9 : "video/webm"`, i.e. it asked
 * the browser once and then handed the plain container over regardless. If
 * even that is unsupported the `MediaRecorder` constructor throws
 * `NotSupportedError`, which the caller's `describeAcquireError` names.
 */
function pickMimeType(candidates: readonly string[]): string {
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return candidates[candidates.length - 1];
}

/** `video/webm;codecs=vp9,opus` → `video/webm`. */
function containerOf(mimeType: string): string {
  return mimeType.split(";")[0].trim();
}

/**
 * The containers MediaRecorder is known to emit, and the extension each one
 * should wear. Anything unrecognised keeps the tool's declared extension —
 * guessing from a subtype we have never seen would be worse than the default.
 */
const EXTENSION_BY_CONTAINER: Record<string, string> = {
  "video/webm": "webm",
  "audio/webm": "webm",
  "video/mp4": "mp4",
  "audio/mp4": "m4a",
  "video/x-matroska": "mkv",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
};

function extensionFor(mimeType: string, fallback: string): string {
  return EXTENSION_BY_CONTAINER[containerOf(mimeType)] ?? fallback;
}

/**
 * `audio/webm;codecs=opus` → `OPUS IN WEBM`; `video/webm` → `WEBM`.
 *
 * Read off the mime the recorder reported, so the line says what the file is
 * rather than what the page hoped for.
 */
export function describeRecordingFormat(mimeType: string): string {
  const parts = mimeType.split(";");
  const container = (parts[0].split("/")[1] ?? parts[0]).trim().toUpperCase();
  const codecs = parts
    .slice(1)
    .map((p) => p.trim())
    .find((p) => p.toLowerCase().startsWith("codecs="))
    ?.slice("codecs=".length)
    .replace(/["']/g, "");
  if (!codecs) return container;
  return `${codecs
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .join(" + ")} IN ${container}`;
}

/** The DOMException name, or null for anything that is not one. */
export function acquireErrorName(err: unknown): string | null {
  return err instanceof DOMException ? err.name : null;
}

export interface MediaDeviceChoices {
  /**
   * Only devices carrying a real `deviceId` — the ones a picker can actually
   * select. Before a grant every engine (measured: Chromium, Firefox, WebKit)
   * returns exactly ONE entry per kind with `deviceId`, `label` and `groupId`
   * all empty: it means "at least one of these exists", not "there is one of
   * these". Rendering that entry as an option produces a row whose value is
   * the same empty string as "Browser default", so picking it does nothing;
   * counting it produces "One camera is attached" on a machine with three.
   */
  devices: MediaDeviceInfo[];
  /**
   * TRUE when the browser listed devices of this kind and named none of them
   * — the pre-permission state, whether it withheld the ids too (the
   * placeholder above) or only the labels. `enumerateDevices` blanks labels
   * until the page has been granted permission for that kind once, so the
   * picker has to say so rather than assert a count it does not have.
   */
  labelsHidden: boolean;
  /** Re-read the list — worth calling right after a successful acquire. */
  refresh: () => void;
}

/**
 * The devices of one kind this browser will admit to. Used by the camera and
 * microphone pickers; the screen recorder has no device list to offer, because
 * the surface picker is the browser's own dialog.
 */
export function useMediaDevices(kind: MediaDeviceKind): MediaDeviceChoices {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const liveRef = useRef(true);

  const refresh = useCallback(() => {
    const md = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    md.enumerateDevices()
      .then((all) => {
        if (liveRef.current) setDevices(all.filter((d) => d.kind === kind));
      })
      .catch(() => {
        // Rejects in an insecure context and on browsers that gate it behind
        // permission. The picker then stays on "Default", which still records.
      });
  }, [kind]);

  useEffect(() => {
    liveRef.current = true;
    refresh();
    const md = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    md?.addEventListener?.("devicechange", refresh);
    return () => {
      liveRef.current = false;
      md?.removeEventListener?.("devicechange", refresh);
    };
  }, [refresh]);

  return {
    // The placeholder entry is dropped here rather than at each call site:
    // an option with an empty `value` duplicates "Browser default", and React
    // re-selects the FIRST option carrying a value, so it can never even stay
    // picked.
    devices: devices.filter((d) => d.deviceId),
    labelsHidden: devices.length > 0 && devices.every((d) => !d.label),
    refresh,
  };
}

/** The last-resort acquisition message, shared by all three recorders. */
export function genericAcquireMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Failed to start recording";
}
