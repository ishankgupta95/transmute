"use client";

import { useCallback, useState } from "react";
import { Monitor } from "lucide-react";
import { ToolAsideSection } from "@/components/tools/ToolAside";
import {
  MediaRecorderShell,
  acquireErrorName,
  genericAcquireMessage,
} from "@/components/tools/MediaRecorderShell";

/*
  The state machine this page used to hold inline now lives in
  `MediaRecorderShell`, which /webcam-recorder and /audio-recorder share. What
  stayed here is the part that is genuinely about capturing a screen: the
  display-capture call, the optional second `getUserMedia` stream merged into
  it, the metadata line that names the captured surface, and the copy.

  Nothing this page renders changed in the move. Its e2e specs drive the
  literal labels "Start Recording", "Stop and save", "Pause" and "Resume"
  (`e2e/conversion/interactions.spec.ts`, `e2e/conversion/workspace.spec.ts`),
  its download name is asserted to be a WebM, and its surface height is a
  measured entry in `tool-surface-heights.ts` — a changed idle layout is CLS on
  a shipped page, not a cosmetic diff.
*/

/** The screen path prefers VP9 + Opus and falls back to the plain container. */
const MIME_CANDIDATES = ["video/webm;codecs=vp9,opus", "video/webm"] as const;

export function ScreenRecorderUI() {
  const [includeAudio, setIncludeAudio] = useState(false);

  const acquireStream = useCallback(async () => {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });

    if (!includeAudio) return displayStream;

    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      return new MediaStream([...displayStream.getTracks(), ...audioStream.getAudioTracks()]);
    } catch {
      // Microphone denied — continue with display stream only
      return displayStream;
    }
  }, [includeAudio]);

  // The doc's metadata line: what we captured, in what codec, mic or not.
  const metaFor = useCallback((stream: MediaStream, mime: string) => {
    const videoTrack = stream.getVideoTracks()[0];
    const settings = videoTrack?.getSettings() ?? {};
    const micOn = stream.getAudioTracks().length > 0;
    return [
      settings.width && settings.height
        ? `${videoTrack.label || "SCREEN"} · ${settings.width}×${settings.height}`
        : videoTrack?.label || "SCREEN",
      mime.includes("vp9") ? "VP9 + OPUS" : "WEBM",
      micOn ? "MIC ON" : "MIC OFF",
    ];
  }, []);

  return (
    <MediaRecorderShell
      acquireStream={acquireStream}
      showPreview={false}
      fileNamePrefix="screen-recording"
      mimeCandidates={MIME_CANDIDATES}
      fileExtension="webm"
      stopOnTrackEnded
      metaFor={metaFor}
      describeAcquireError={describeAcquireError}
      idleIcon={<Monitor size={28} className="text-text-muted" aria-hidden="true" />}
      idleHint="Start recording and your browser will ask which screen, window or tab to capture."
      outputNote={
        <>
          Recorded as WebM. Ending the share from the browser&rsquo;s own bar also stops the
          recording.
        </>
      }
      controls={
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
      }
    />
  );
}

function describeAcquireError(err: unknown): string {
  return acquireErrorName(err) === "NotAllowedError"
    ? "Screen sharing was cancelled or denied."
    : genericAcquireMessage(err);
}
