"use client";

import { useCallback, useState } from "react";
import { Mic } from "lucide-react";
import { ToolControl, ToolControlGroup } from "@/components/tools/ToolControls";
import {
  MediaRecorderShell,
  acquireErrorName,
  describeRecordingFormat,
  genericAcquireMessage,
  useMediaDevices,
} from "@/components/tools/MediaRecorderShell";
import { cn } from "@/lib/utils/cn";

/*
  The same MediaRecorder shell with no video track at all: the level meter
  becomes the stage, the finished clip plays back through `<audio>`, and the
  canvas header reads the microphone's own rate and channel count instead of a
  frame size.

  The one thing this page must not do is imply MP3. There is no encoder on
  this page at all: the chunks `MediaRecorder` hands over are concatenated into
  a Blob and offered as-is, in whatever container the browser chose. So no copy
  here names a format — the line under the OUTPUT rows is built from
  `MediaRecorder.mimeType` after the fact, which is the only thing that knows.
*/

const FIELD_CLASS =
  "h-[30px] rounded-[7px] border border-border bg-bg-elevated px-2.5 font-mono text-xs leading-none text-text-primary focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const NOTE_CLASS = "font-body text-[10.5px] leading-[1.5] text-text-muted";

/*
  Ordered best-codec-first and asked one at a time via `isTypeSupported`, so
  the browser decides. `audio/mp4` sits last, which also makes it the form a
  browser supporting none of the others is handed; the download then carries
  the `.m4a` extension that container wants, because the file name follows
  `MediaRecorder.mimeType` rather than this list.
*/
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
] as const;

export function AudioRecorderUI() {
  const [deviceId, setDeviceId] = useState("");
  const { devices, labelsHidden, refresh } = useMediaDevices("audioinput");

  const acquireStream = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    });
    // Labels are blank until a grant lands. Now one has, so re-read the list.
    refresh();
    return stream;
  }, [deviceId, refresh]);

  const metaFor = useCallback((stream: MediaStream, mime: string) => {
    const track = stream.getAudioTracks()[0];
    const settings = track?.getSettings() ?? {};
    return [
      track?.label || "MICROPHONE",
      describeRecordingFormat(mime),
      settings.sampleRate ? `${+(settings.sampleRate / 1000).toFixed(1)} kHz` : "RATE UNREPORTED",
    ];
  }, []);

  return (
    <MediaRecorderShell
      acquireStream={acquireStream}
      showPreview={false}
      audioOnly
      fileNamePrefix="audio-recording"
      mimeCandidates={MIME_CANDIDATES}
      fileExtension="webm"
      metaFor={metaFor}
      describeAcquireError={describeAcquireError}
      idleIcon={<Mic size={28} className="text-text-muted" aria-hidden="true" />}
      idleHint="Start recording and your browser will ask to use the microphone. The level meter shows what it is hearing."
      outputNote={
        <>
          Nothing leaves this tab. This page has no encoder in it — it saves exactly what your
          browser&rsquo;s recorder writes, which is not an MP3. Elapsed is this page&rsquo;s own
          clock: the file is written in one-second chunks and carries no duration header, so a
          player may show no length until it has read the whole thing.
        </>
      }
      formatNote={(mime) => `Your browser wrote this recording as ${describeRecordingFormat(mime)}.`}
      controls={
        <ToolControlGroup>
          <ToolControl label="MICROPHONE">
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              aria-label="Microphone"
              className={cn(FIELD_CLASS, "w-full")}
            >
              <option value="">Browser default</option>
              {devices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Microphone ${i + 1}`}
                </option>
              ))}
            </select>
            {/*
              No count — see the same note on /webcam-recorder. The
              pre-permission list is one empty placeholder per kind, which says
              "at least one exists" and nothing about how many.
            */}
            {labelsHidden ? (
              <span className={NOTE_CLASS}>
                Microphone names are hidden until you allow access once — start a recording and the
                names appear here.
              </span>
            ) : devices.length === 0 ? (
              <span className={NOTE_CLASS}>
                No microphones listed yet. Browsers hide the device list until this page has been
                allowed to use one — start a recording and the names appear here.
              </span>
            ) : null}
          </ToolControl>
        </ToolControlGroup>
      }
    />
  );
}

function describeAcquireError(err: unknown): string {
  switch (acquireErrorName(err)) {
    case "NotAllowedError":
      return "Microphone access was denied. Allow this site to use the microphone and start again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No microphone was found. Connect one and start again.";
    case "NotReadableError":
    case "TrackStartError":
      return "The microphone could not be opened — something else is usually already using it. Close the other app or tab and start again.";
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "That microphone is no longer available. Pick another one and start again.";
    default:
      return genericAcquireMessage(err);
  }
}
