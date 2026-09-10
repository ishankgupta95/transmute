"use client";

import { useCallback, useState } from "react";
import { Camera } from "lucide-react";
import { ToolChoice, ToolAsideSection } from "@/components/tools/ToolAside";
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
  The webcam sibling of /screen-recorder. Four things genuinely differ, and
  they are the only reason this file exists rather than a prop on that one:

  1. `getUserMedia` takes the camera AND the microphone in one call, so the
     screen path's "merge a second mic stream in" branch has nothing to do.
  2. A live picture is mandatory — a recorder you cannot frame yourself in is
     useless — and the screen recorder has no preview at all.
  3. There is no browser-level "Stop sharing" bar, so no `ended` auto-stop.
  4. A camera can be missing, or held open by another app. `getDisplayMedia`
     never raises `NotFoundError` or `NotReadableError`; this does.
*/

const FIELD_CLASS =
  "h-[30px] rounded-[7px] border border-border bg-bg-elevated px-2.5 font-mono text-xs leading-none text-text-primary focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const NOTE_CLASS = "font-body text-[10.5px] leading-[1.5] text-text-muted";

/*
  VP9 first, then VP8, then the bare container, and MP4 as the last resort —
  which is also what a browser supporting none of the WebM forms is handed.
  Nothing here is a promise: `MediaRecorder` reports what it actually chose and
  the rail prints that, so a Safari MP4 is named as an MP4 and downloaded as
  one.
*/
const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
] as const;

/*
  The same list with the audio codec struck out, used when the microphone is
  off. `MediaRecorder.isTypeSupported` answers about the codec registry, not
  about the stream: it says yes to `vp9,opus` for a camera-only capture, the
  constructor accepts it, and Chrome's `MediaRecorder.mimeType` then echoes the
  string back until the recording stops. Measured on Chromium 148 with a
  video-only stream: the file's only EBML CodecID is `V_VP9` — there is no
  Opus track in it — while the page printed "VP9 + OPUS IN WEBM" beside its own
  "MIC OFF". Asking for what the stream can actually carry makes the mime the
  rail reads back true at the moment it is read, on every engine, rather than
  relying on one browser correcting itself later.
*/
const SILENT_MIME_CANDIDATES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4",
] as const;

const FACING_OPTIONS = [
  { value: "user" as const, label: "Front" },
  { value: "environment" as const, label: "Rear" },
];

export function WebcamRecorderUI() {
  const [deviceId, setDeviceId] = useState("");
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [micOn, setMicOn] = useState(true);
  const { devices, labelsHidden, refresh } = useMediaDevices("videoinput");

  const acquireStream = useCallback(async () => {
    /*
      A named device wins outright; `facingMode` is the fallback for the case
      where there is nothing to name yet — which is every phone on a first
      visit, because labels (and useful ids) only appear after one grant.
    */
    const video: MediaTrackConstraints = deviceId ? { deviceId: { exact: deviceId } } : { facingMode };
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio: micOn });
    // Labels are blank until a grant lands. Now one has, so re-read the list.
    refresh();
    return stream;
  }, [deviceId, facingMode, micOn, refresh]);

  const metaFor = useCallback((stream: MediaStream, mime: string) => {
    const track = stream.getVideoTracks()[0];
    const settings = track?.getSettings() ?? {};
    return [
      settings.width && settings.height
        ? `${track.label || "CAMERA"} · ${settings.width}×${settings.height}`
        : track?.label || "CAMERA",
      describeRecordingFormat(mime),
      stream.getAudioTracks().length > 0 ? "MIC ON" : "MIC OFF",
    ];
  }, []);

  const describeAcquireError = useCallback(
    (err: unknown): string => {
      switch (acquireErrorName(err)) {
        case "NotAllowedError":
          return micOn
            ? "Camera or microphone access was denied. Allow this site to use them and start again."
            : "Camera access was denied. Allow this site to use the camera and start again.";
        case "NotFoundError":
        case "DevicesNotFoundError":
          return micOn
            ? "No camera or microphone was found. Connect one and start again."
            : "No camera was found. Connect one and start again.";
        case "NotReadableError":
        case "TrackStartError":
          return "The camera could not be opened — something else is usually already using it. Close the other app or tab and start again.";
        case "OverconstrainedError":
        case "ConstraintNotSatisfiedError":
          return "That camera is no longer available. Pick another one and start again.";
        default:
          return genericAcquireMessage(err);
      }
    },
    [micOn],
  );

  return (
    <MediaRecorderShell
      acquireStream={acquireStream}
      showPreview
      fileNamePrefix="webcam-recording"
      mimeCandidates={micOn ? MIME_CANDIDATES : SILENT_MIME_CANDIDATES}
      fileExtension="webm"
      metaFor={metaFor}
      describeAcquireError={describeAcquireError}
      idleIcon={<Camera size={28} className="text-text-muted" aria-hidden="true" />}
      /* The preview element only exists while `status` is "recording" or
         "paused", and `recorder.start()` runs before `setStatus("recording")`
         — so there is no state in which the picture is up and nothing is being
         captured. The old wording ("The picture appears here first") promised
         a framing stage this page does not have. */
      idleHint="Start recording and your browser will ask to use the camera. The picture and the recording start together — nothing is captured before that."
      outputNote={
        <>
          Nothing leaves this tab. Elapsed is this page&rsquo;s own clock: the file is written in
          one-second chunks and carries no duration header, so a player may show no length until it
          has read the whole thing.
        </>
      }
      formatNote={(mime) => `Your browser wrote this clip as ${describeRecordingFormat(mime)}.`}
      controls={
        <>
          <ToolControlGroup>
            <ToolControl label="CAMERA">
              <select
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                aria-label="Camera"
                className={cn(FIELD_CLASS, "w-full")}
              >
                <option value="">Browser default</option>
                {devices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
              {/*
                No count. Before a grant the browser returns ONE entry per kind
                with an empty id and an empty label — it means "at least one
                exists", and it says that on a machine with three cameras, so
                counting the list was a claim about the user's own hardware
                that the list cannot support. `useMediaDevices` drops that
                entry from `devices` (an option with an empty value is a
                duplicate of "Browser default" and cannot stay selected), and
                `labelsHidden` is what is left to say.
              */}
              {labelsHidden ? (
                <span className={NOTE_CLASS}>
                  Camera names are hidden until you allow access once — start a recording and the
                  names appear here.
                </span>
              ) : devices.length === 0 ? (
                <span className={NOTE_CLASS}>
                  No cameras listed yet. Browsers hide the device list until this page has been
                  allowed to use a camera once — start a recording and the names appear here.
                </span>
              ) : null}
            </ToolControl>

            <ToolControl label="FACING">
              <ToolChoice
                options={FACING_OPTIONS}
                value={facingMode}
                onChange={setFacingMode}
                label="Camera facing"
                disabled={deviceId !== ""}
              />
              <span className={NOTE_CLASS}>
                {deviceId !== ""
                  ? "Ignored while a specific camera is chosen above."
                  : "Phones use this to pick between the front and rear camera. Most desktop webcams report no facing at all, so it changes nothing there."}
              </span>
            </ToolControl>
          </ToolControlGroup>

          <ToolAsideSection label="AUDIO">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={micOn}
                onChange={(e) => setMicOn(e.target.checked)}
                className="mt-0.5 rounded border-border accent-accent"
              />
              <span>
                <span className="block text-[12.5px] leading-[1.2] text-neutral-300">
                  Include microphone audio
                </span>
                <span className="mt-1 block font-body text-[10.5px] leading-[1.5] text-text-muted">
                  The camera and the microphone are asked for together, so turning this off means
                  the browser never requests the microphone at all
                </span>
              </span>
            </label>
          </ToolAsideSection>
        </>
      }
    />
  );
}
