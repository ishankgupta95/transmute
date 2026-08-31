"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { videoMeta, type Dimensions } from "@/lib/utils/canvas-meta";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { Monitor } from "lucide-react";
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

type Status = "idle" | "recording" | "paused" | "done" | "error";

export function ScreenRecorderUI() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [includeAudio, setIncludeAudio] = useState(false);
  const [recording, setRecording] = useState<{ blob: Blob; url: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState<number | null>(null);
  const [meta, setMeta] = useState<string[]>([]);
  /* The doc's video readout leads with the frame size. The capture's own
     track settings are the authority here — the played-back WebM declares no
     duration, so the elapsed counter supplies the clip length instead. */
  const [captureDims, setCaptureDims] = useState<Dimensions | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const meterRef = useRef<{ ctx: AudioContext; raf: number } | null>(null);

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
      ctx.createMediaStreamSource(stream).connect(analyser);
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
  // otherwise the screen-share / mic indicator stays on and recording continues
  // in the background (privacy + resource leak).
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

  const startRecording = useCallback(async () => {
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
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      let combinedStream = displayStream;

      if (includeAudio) {
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const tracks = [...displayStream.getTracks(), ...audioStream.getAudioTracks()];
          combinedStream = new MediaStream(tracks);
        } catch {
          // Microphone denied — continue with display stream only
        }
      }

      streamRef.current = combinedStream;
      chunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : "video/webm";

      const recorder = new MediaRecorder(combinedStream, { mimeType });
      mediaRecorderRef.current = recorder;

      // The doc's metadata line: what we captured, in what codec, mic or not.
      const videoTrack = displayStream.getVideoTracks()[0];
      const settings = videoTrack?.getSettings() ?? {};
      const micOn = combinedStream.getAudioTracks().length > 0;
      setCaptureDims(
        settings.width && settings.height ? { w: settings.width, h: settings.height } : null,
      );
      setMeta([
        settings.width && settings.height
          ? `${videoTrack.label || "SCREEN"} · ${settings.width}×${settings.height}`
          : videoTrack?.label || "SCREEN",
        mimeType.includes("vp9") ? "VP9 + OPUS" : "WEBM",
        micOn ? "MIC ON" : "MIC OFF",
      ]);
      if (micOn) startMeter(new MediaStream(combinedStream.getAudioTracks()));

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        setRecording({ blob, url });
        setStatus("done");
        stopMeter();

        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      };

      // Stop when user ends sharing via browser UI
      displayStream.getVideoTracks()[0].addEventListener("ended", () => {
        if (recorder.state !== "inactive") recorder.stop();
        stopAllTracks(combinedStream);
      });

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
      stopMeter();
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError("Screen sharing was cancelled or denied.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to start recording");
      }
      setStatus("error");
    }
  }, [includeAudio, recording, startMeter, stopMeter]);

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
            <Monitor size={28} className="text-text-muted" aria-hidden="true" />
            <p className="text-sm text-text-secondary">Nothing recorded yet</p>
            <p className="max-w-xs text-xs text-text-muted">
              Start recording and your browser will ask which screen, window or tab to capture.
            </p>
          </div>
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
              meta={videoMeta(captureDims, formatElapsed(elapsed), formatFileSize(recording.blob.size))}
            />
            <CanvasStage className={cn(STAGE_GROW, "flex items-center justify-center bg-black")}>
              <video src={recording.url} controls className={cn(STAGE_MEDIA, "bg-black")} />
            </CanvasStage>
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
                fileName={`screen-recording-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.webm`}
                className="w-full justify-center"
              />
              <ToolResetLink onClick={handleReset} label="RECORD ANOTHER" />
            </>
          ) : status === "error" ? (
            <ToolActions primaryLabel="Try again" onPrimary={handleReset} />
          ) : (
            <ToolActions primaryLabel="Start Recording" onPrimary={startRecording} />
          )
        }
      >
        {status === "idle" && !recording && (
          <ToolAsideSection label="AUDIO">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={includeAudio}
                onChange={(e) => setIncludeAudio(e.target.checked)}
                className="mt-0.5 rounded border-border accent-accent"
              />
              <span>
                <span className="block text-[12.5px] leading-[1.2] text-neutral-300">
                  Include microphone audio
                </span>
                <span className="mt-1 block font-body text-[10.5px] leading-[1.5] text-text-muted">
                  Record narration along with screen capture
                </span>
              </span>
            </label>
          </ToolAsideSection>
        )}

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Status", STATUS_LABEL[status]],
              ["Elapsed", formatElapsed(elapsed)],
              ["Size", recording ? formatFileSize(recording.blob.size) : "—"],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Recorded as WebM. Ending the share from the browser&rsquo;s own bar also stops the
            recording.
          </span>
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
