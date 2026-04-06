"use client";

import { useCallback, useRef, useState } from "react";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { formatFileSize } from "@/lib/utils/file-helpers";

type Status = "idle" | "recording" | "paused" | "done" | "error";

export function ScreenRecorderUI() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [includeAudio, setIncludeAudio] = useState(false);
  const [recording, setRecording] = useState<{ blob: Blob; url: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRecording = useCallback(async () => {
    setError(null);
    setRecording(null);
    setElapsed(0);

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

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        setRecording({ blob, url });
        setStatus("done");

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
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError("Screen sharing was cancelled or denied.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to start recording");
      }
      setStatus("error");
    }
  }, [includeAudio]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      stopAllTracks(streamRef.current);
    }
  }, []);

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

  return (
    <div className="space-y-6">
      {status === "idle" && !recording && (
        <>
          {/* Audio toggle */}
          <div className="rounded-lg border border-border bg-bg-elevated p-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={includeAudio}
                onChange={(e) => setIncludeAudio(e.target.checked)}
                className="rounded border-border"
              />
              <div>
                <span className="text-sm font-medium text-text-primary">Include microphone audio</span>
                <p className="text-xs text-text-muted mt-0.5">Record narration along with screen capture</p>
              </div>
            </label>
          </div>

          <div className="flex justify-center">
            <button
              onClick={startRecording}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-8 py-3 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors"
            >
              <span className="inline-block h-3 w-3 rounded-full bg-bg-primary" />
              Start Recording
            </button>
          </div>

          <p className="text-sm text-text-muted text-center">
            Click to select a screen, window, or tab to record.
          </p>
        </>
      )}

      {(status === "recording" || status === "paused") && (
        <div className="space-y-6">
          <div className="rounded-lg border border-border bg-bg-elevated p-6 text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <span className={`inline-block h-3 w-3 rounded-full ${status === "recording" ? "bg-error animate-pulse" : "bg-yellow-500"}`} />
              <span className="text-sm font-medium text-text-primary">
                {status === "recording" ? "Recording..." : "Paused"}
              </span>
            </div>
            <p className="text-3xl font-mono text-text-primary">{formatElapsed(elapsed)}</p>
          </div>

          <div className="flex items-center justify-center gap-3">
            {status === "recording" ? (
              <button
                onClick={pauseRecording}
                className="rounded-md border border-border px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
              >
                Pause
              </button>
            ) : (
              <button
                onClick={resumeRecording}
                className="rounded-md border border-border px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
              >
                Resume
              </button>
            )}
            <button
              onClick={stopRecording}
              className="inline-flex items-center gap-2 rounded-md bg-error px-6 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
            >
              Stop Recording
            </button>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="space-y-4">
          <p className="text-sm text-error text-center">{error}</p>
          <div className="flex justify-center">
            <button
              onClick={handleReset}
              className="rounded-md border border-border px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {status === "done" && recording && (
        <div className="space-y-6">
          <div className="rounded-lg border border-border bg-bg-elevated p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-text-primary">Recording</p>
              <span className="text-xs text-text-muted">
                {formatFileSize(recording.blob.size)} &middot; {formatElapsed(elapsed)}
              </span>
            </div>
            <video
              src={recording.url}
              controls
              className="w-full rounded max-h-80 bg-black"
            />
          </div>

          <div className="flex items-center justify-center gap-3">
            <DownloadButton
              blob={recording.blob}
              fileName={`screen-recording-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.webm`}
            />
            <button
              onClick={handleReset}
              className="rounded-md border border-border px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
            >
              Record another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function stopAllTracks(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
