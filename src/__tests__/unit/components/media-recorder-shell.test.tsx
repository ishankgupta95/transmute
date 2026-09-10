import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/*
  THREE RECORDERS, ONE STATE MACHINE — AND ONE OF THEM IS PINNED.

  `/screen-recorder` shipped before this shell existed. Its e2e specs drive the
  literal labels "Start Recording", "Stop and save", "Pause" and "Resume"
  (`e2e/conversion/interactions.spec.ts:139-161`, `e2e/conversion/workspace.spec.ts:200-204`),
  its download is asserted to be a WebM, and `tool-surface-heights.ts:126`
  reserves 634px of idle surface for it to stop the CLS that a wrong number
  causes. So the first half of this file is a regression net for strings, not a
  behaviour test: it asserts the exact copy the refactor had to carry across.

  The second half is about the two new siblings, and about the three claims
  that are easy to get wrong and impossible to see:

  * `recorder.start(1000)` writes a timesliced WebM, which carries no Duration
    element (`lib/tools/video-utils.ts:40-52`). Every duration this UI shows is
    therefore the page's own second counter, never a reading of the file.
  * The container is the browser's choice, not ours. The blob type, the file
    extension and the format line all have to follow `MediaRecorder.mimeType`
    rather than the candidate we asked for, or a Safari MP4 gets handed over
    named `.webm`.
  * `enumerateDevices` returns entries with EMPTY labels until the page has
    been granted permission once. A picker that renders those as options is a
    list of blank rows.

  Copy strings are duplicated here rather than imported — a test that reads the
  constant it checks cannot notice the constant changing.
*/

const SCREEN_IDLE_HINT =
  "Start recording and your browser will ask which screen, window or tab to capture.";
const SCREEN_OUTPUT_NOTE =
  "Recorded as WebM. Ending the share from the browser’s own bar also stops the recording.";
const SCREEN_DENIED = "Screen sharing was cancelled or denied.";
const SCREEN_AUDIO_LABEL = "Include microphone audio";
const SCREEN_AUDIO_HINT = "Record narration along with screen capture";

// ── Fakes for the platform jsdom does not implement ───────────────────────

interface FakeTrack {
  kind: string;
  label: string;
  stop: ReturnType<typeof vi.fn>;
  getSettings: () => MediaTrackSettings;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
  fire: (type: string) => void;
}

function fakeTrack(kind: "video" | "audio", label: string, settings: MediaTrackSettings): FakeTrack {
  const listeners = new Map<string, Set<() => void>>();
  return {
    kind,
    label,
    stop: vi.fn(),
    getSettings: () => settings,
    addEventListener: (type, fn) => {
      const set = listeners.get(type) ?? new Set();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener: (type, fn) => {
      listeners.get(type)?.delete(fn);
    },
    fire: (type) => {
      listeners.get(type)?.forEach((fn) => fn());
    },
  };
}

function fakeStream(tracks: FakeTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
  } as unknown as MediaStream;
}

const SCREEN_TRACK = () => fakeTrack("video", "Screen 1", { width: 1280, height: 720 });
const CAMERA_TRACK = () => fakeTrack("video", "FaceTime HD Camera", { width: 640, height: 480 });
const MIC_TRACK = () =>
  fakeTrack("audio", "MacBook Pro Microphone", { sampleRate: 48000, channelCount: 1 });

class FakeMediaRecorder {
  static supported = new Set<string>();
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported(type: string) {
    return FakeMediaRecorder.supported.has(type);
  }

  state: "inactive" | "recording" | "paused" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  /** What the browser says it is writing. Deliberately settable per test. */
  mimeType: string;

  constructor(
    public stream: MediaStream,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? "";
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["chunk"]) });
    this.onstop?.();
  }
}

/** Every blob the shell handed to `createObjectURL`, newest last. */
let createdBlobs: Blob[] = [];

/** A promise the test resolves by hand — the device-open window, held open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * A counting `AudioContext`, because the level meter's leak is invisible
 * otherwise: jsdom has none, so `startMeter` silently bails and a test that
 * does not install this one cannot tell one context from three.
 */
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  closed = false;

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createAnalyser() {
    return {
      fftSize: 0,
      frequencyBinCount: 8,
      getByteTimeDomainData: () => {},
      connect: () => {},
    };
  }

  createMediaStreamSource() {
    return { connect: () => {} };
  }

  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

/** Install the counting meter platform. Undone by `vi.unstubAllGlobals()`. */
function stubAudioMeter() {
  FakeAudioContext.instances = [];
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
}

beforeEach(() => {
  createdBlobs = [];
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.supported = new Set(["video/webm;codecs=vp9,opus", "video/webm"]);

  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal(
    "MediaStream",
    class {
      private tracks: FakeTrack[];
      constructor(tracks: FakeTrack[] = []) {
        this.tracks = tracks;
      }
      getTracks() {
        return this.tracks;
      }
      getAudioTracks() {
        return this.tracks.filter((t) => t.kind === "audio");
      }
      getVideoTracks() {
        return this.tracks.filter((t) => t.kind === "video");
      }
    },
  );

  URL.createObjectURL = vi.fn((blob: Blob) => {
    createdBlobs.push(blob);
    return `blob:fake/${createdBlobs.length}`;
  }) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(),
      getDisplayMedia: vi.fn(),
      enumerateDevices: vi.fn().mockResolvedValue([]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

import {
  MediaRecorderShell,
  describeRecordingFormat,
  genericAcquireMessage,
  type MediaRecorderShellProps,
} from "@/components/tools/MediaRecorderShell";
import { ScreenRecorderUI } from "@/components/tools/ScreenRecorderUI";
import { WebcamRecorderUI } from "@/components/tools/WebcamRecorderUI";
import { AudioRecorderUI } from "@/components/tools/AudioRecorderUI";

const mediaDevices = () =>
  navigator.mediaDevices as unknown as {
    getUserMedia: ReturnType<typeof vi.fn>;
    getDisplayMedia: ReturnType<typeof vi.fn>;
    enumerateDevices: ReturnType<typeof vi.fn>;
  };

function shell(props: Partial<MediaRecorderShellProps> = {}) {
  const defaults: MediaRecorderShellProps = {
    acquireStream: async () => fakeStream([SCREEN_TRACK()]),
    showPreview: false,
    fileNamePrefix: "test-recording",
    mimeCandidates: ["video/webm;codecs=vp9,opus", "video/webm"],
    fileExtension: "webm",
    describeAcquireError: (err) => `mapped: ${genericAcquireMessage(err)}`,
    idleIcon: <span data-testid="idle-icon" />,
    idleHint: "Idle hint copy.",
    outputNote: "Output note copy.",
  };
  return render(<MediaRecorderShell {...defaults} {...props} />);
}

const startButton = () => screen.getByRole("button", { name: "Start Recording" });
const stopButton = () => screen.getByRole("button", { name: "Stop and save" });
const downloadName = () => {
  const label = screen.getByRole("button", { name: /^Download / }).getAttribute("aria-label");
  return label!.replace(/^Download /, "");
};

async function start() {
  await act(async () => {
    fireEvent.click(startButton());
  });
}

// ──────────────────────────────────────────────────────────────────────────

describe("describeRecordingFormat", () => {
  it("names the codecs and the container the recorder reported", () => {
    expect(describeRecordingFormat("audio/webm;codecs=opus")).toBe("OPUS IN WEBM");
    expect(describeRecordingFormat("video/webm;codecs=vp9,opus")).toBe("VP9 + OPUS IN WEBM");
  });

  it("falls back to the container alone when no codecs parameter is present", () => {
    expect(describeRecordingFormat("video/mp4")).toBe("MP4");
    expect(describeRecordingFormat("audio/webm")).toBe("WEBM");
  });
});

describe("MediaRecorderShell — what the browser chose", () => {
  it("asks for the first supported candidate", async () => {
    FakeMediaRecorder.supported = new Set(["video/webm"]);
    shell();
    await start();
    expect(FakeMediaRecorder.instances[0].mimeType).toBe("video/webm");
  });

  it("uses the last candidate when the browser supports none of them", async () => {
    // Not a failure path: the screen recorder's original line handed the plain
    // container over regardless of what isTypeSupported said.
    FakeMediaRecorder.supported = new Set();
    shell({ mimeCandidates: ["video/webm;codecs=av1", "video/webm"] });
    await start();
    expect(FakeMediaRecorder.instances[0].mimeType).toBe("video/webm");
  });

  it("writes the blob with the container, not the full codec string", async () => {
    shell();
    await start();
    await act(async () => {
      fireEvent.click(stopButton());
    });
    expect(createdBlobs.at(-1)!.type).toBe("video/webm");
  });

  it("extends the file name from MediaRecorder.mimeType, not the declared fallback", async () => {
    // The Safari case: we asked for WebM, the browser wrote MP4. A `.webm`
    // name on an MP4 is the silent-mislabel this follows mimeType to avoid.
    FakeMediaRecorder.supported = new Set(["audio/mp4"]);
    shell({
      mimeCandidates: ["audio/webm;codecs=opus", "audio/mp4"],
      fileExtension: "webm",
      fileNamePrefix: "audio-recording",
    });
    await start();
    await act(async () => {
      fireEvent.click(stopButton());
    });
    expect(downloadName()).toMatch(/^audio-recording-.*\.m4a$/);
    expect(createdBlobs.at(-1)!.type).toBe("audio/mp4");
  });
});

/*
  ── THE ACQUIRE WINDOW ──────────────────────────────────────────────────────

  `acquireStream` awaits a device opening, and nothing above that await moves
  `status`, so the primary stays enabled and labelled "Start Recording" for the
  whole 100 ms–2 s a microphone or a cold camera takes. Every test below drives
  its two presses inside ONE `act`, so React has not re-rendered between them:
  that is the real shape of a double-click, and it is the only shape where the
  `disabled` attribute cannot help — a synchronous ref is the guard being
  tested. Two entrants used to share one chunk array (an unplayable clip built
  from two WebM byte streams), orphan the first stream (camera light on after
  "Stop and save"), run two intervals (the clock at 2x, forever) and open a
  second AudioContext while the first was never closed.
*/
describe("MediaRecorderShell — only one entrant per acquire window", () => {
  it("refuses a second press, and a held ⌘↵, while the device is opening", async () => {
    vi.useFakeTimers();
    const gate = deferred<MediaStream>();
    const acquireStream = vi.fn(() => gate.promise);
    const camera = CAMERA_TRACK();
    const mic = MIC_TRACK();

    shell({ acquireStream });

    act(() => {
      const button = startButton();
      fireEvent.click(button);
      fireEvent.click(button);
      // ToolActions binds ⌘/Ctrl+Enter on window with no key-repeat guard, so
      // holding the chord is a second way in.
      fireEvent.keyDown(window, { key: "Enter", metaKey: true });
      fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    });
    expect(acquireStream).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate.resolve(fakeStream([camera, mic]));
      await gate.promise;
    });

    // One recorder, so one chunk array and one WebM byte stream in the file.
    expect(FakeMediaRecorder.instances).toHaveLength(1);

    // One interval: three real seconds are three clip seconds, not six.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getAllByText("00:03").length).toBeGreaterThan(0);
    expect(screen.queryByText("00:06")).toBeNull();

    await act(async () => {
      fireEvent.click(stopButton());
    });
    // Every track of the one stream that was opened is stopped, so the camera
    // and microphone indicators go out with "Stop and save".
    expect(camera.stop).toHaveBeenCalledTimes(1);
    expect(mic.stop).toHaveBeenCalledTimes(1);

    // And the clock is stopped for good, not just the newest of two.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getAllByText("00:03").length).toBeGreaterThan(0);
    expect(screen.queryByText("00:08")).toBeNull();
  });

  it("opens one level meter for two presses, and closes it on stop", async () => {
    stubAudioMeter();
    const gate = deferred<MediaStream>();

    shell({ acquireStream: () => gate.promise });

    act(() => {
      const button = startButton();
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await act(async () => {
      gate.resolve(fakeStream([CAMERA_TRACK(), MIC_TRACK()]));
      await gate.promise;
    });

    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0].closed).toBe(false);

    await act(async () => {
      fireEvent.click(stopButton());
    });
    // Browsers cap AudioContexts per document; one left open per double-click
    // kills the meter permanently and silently.
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0].closed).toBe(true);
  });

  it("shows the press landed by disabling the primary until the device opens", async () => {
    const gate = deferred<MediaStream>();
    shell({ acquireStream: () => gate.promise });

    await act(async () => {
      fireEvent.click(startButton());
    });
    // The visible half of the guard: no feedback at all is what provokes the
    // second click in the first place.
    expect(startButton()).toBeDisabled();

    await act(async () => {
      gate.resolve(fakeStream([SCREEN_TRACK()]));
      await gate.promise;
    });
    expect(stopButton()).toBeVisible();
  });

  it("releases the guard when the acquire fails, so Try again really tries", async () => {
    const acquireStream = vi
      .fn<() => Promise<MediaStream>>()
      .mockRejectedValueOnce(new DOMException("busy", "NotReadableError"))
      .mockResolvedValue(fakeStream([SCREEN_TRACK()]));
    shell({ acquireStream });

    await start();
    expect(screen.getByRole("alert")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await start();

    expect(acquireStream).toHaveBeenCalledTimes(2);
    expect(stopButton()).toBeVisible();
  });
});

describe("MediaRecorderShell — the elapsed readout is a timer, not a file reading", () => {
  it("counts whole seconds from start and pauses with the recorder", async () => {
    vi.useFakeTimers();
    shell();
    await start();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getAllByText("00:03").length).toBeGreaterThan(0);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    // Paused means paused: five more seconds of wall clock, none of them clip.
    expect(screen.getAllByText("00:03").length).toBeGreaterThan(0);
    expect(screen.queryByText("00:08")).toBeNull();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getAllByText("00:05").length).toBeGreaterThan(0);
  });
});

describe("MediaRecorderShell — the ended track", () => {
  it("stops the recording when stopOnTrackEnded is set", async () => {
    const track = SCREEN_TRACK();
    shell({ acquireStream: async () => fakeStream([track]), stopOnTrackEnded: true });
    await start();

    act(() => {
      track.fire("ended");
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /^Download / })).toBeVisible());
  });

  it("ignores an ended track when the tool did not opt in", async () => {
    // A camera or microphone track ending is a device fault, not the user
    // pressing the browser's own "Stop sharing" bar.
    const track = CAMERA_TRACK();
    shell({ acquireStream: async () => fakeStream([track]) });
    await start();

    act(() => {
      track.fire("ended");
    });
    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
    expect(stopButton()).toBeVisible();
  });
});

describe("MediaRecorderShell — controls and errors", () => {
  it("renders the tool's controls while idle and hides them once recording", async () => {
    shell({ controls: <span>DEVICE PICKER</span> });
    expect(screen.getByText("DEVICE PICKER")).toBeVisible();
    await start();
    expect(screen.queryByText("DEVICE PICKER")).toBeNull();
  });

  it("shows the tool's own description of an acquisition failure", async () => {
    shell({
      acquireStream: async () => {
        throw new DOMException("denied", "NotAllowedError");
      },
      describeAcquireError: () => "TOOL SPECIFIC REFUSAL",
    });
    await start();
    expect(screen.getByRole("alert")).toHaveTextContent("TOOL SPECIFIC REFUSAL");
  });

  it("adds the format line only once a clip exists, and only when asked for one", async () => {
    shell({ formatNote: (mime) => `wrote ${describeRecordingFormat(mime)}` });
    expect(screen.queryByText(/^wrote /)).toBeNull();
    await start();
    await act(async () => {
      fireEvent.click(stopButton());
    });
    expect(screen.getByText("wrote VP9 + OPUS IN WEBM")).toBeVisible();
  });
});

// ── /screen-recorder: the pinned surface ──────────────────────────────────

describe("ScreenRecorderUI keeps the surface its e2e specs and CLS budget pin", () => {
  it("renders the idle copy verbatim", () => {
    render(<ScreenRecorderUI />);
    expect(screen.getByText("Nothing recorded yet")).toBeVisible();
    expect(screen.getByText(SCREEN_IDLE_HINT)).toBeVisible();
    expect(screen.getByText(SCREEN_OUTPUT_NOTE)).toBeVisible();
    expect(screen.getByText(SCREEN_AUDIO_LABEL)).toBeVisible();
    expect(screen.getByText(SCREEN_AUDIO_HINT)).toBeVisible();
    expect(screen.getByRole("button", { name: "Start Recording" })).toBeVisible();
  });

  it("drives the control labels the conversion specs click by name", async () => {
    mediaDevices().getDisplayMedia.mockResolvedValue(fakeStream([SCREEN_TRACK()]));
    render(<ScreenRecorderUI />);
    await start();

    expect(screen.getByRole("button", { name: "Stop and save" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Pause" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByRole("button", { name: "Resume" })).toBeVisible();
  });

  it("downloads screen-recording-<timestamp>.webm", async () => {
    mediaDevices().getDisplayMedia.mockResolvedValue(fakeStream([SCREEN_TRACK()]));
    render(<ScreenRecorderUI />);
    await start();
    await act(async () => {
      fireEvent.click(stopButton());
    });
    expect(downloadName()).toMatch(/^screen-recording-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.webm$/);
    expect(screen.getByText("RECORD ANOTHER")).toBeVisible();
  });

  it("still says 'Screen sharing was cancelled or denied.' on NotAllowedError", async () => {
    mediaDevices().getDisplayMedia.mockRejectedValue(new DOMException("no", "NotAllowedError"));
    render(<ScreenRecorderUI />);
    await start();
    expect(screen.getByRole("alert")).toHaveTextContent(SCREEN_DENIED);
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  it("merges a second microphone stream only when the checkbox is ticked", async () => {
    mediaDevices().getDisplayMedia.mockResolvedValue(fakeStream([SCREEN_TRACK()]));
    mediaDevices().getUserMedia.mockResolvedValue(fakeStream([MIC_TRACK()]));
    render(<ScreenRecorderUI />);

    await start();
    expect(mediaDevices().getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByText("MIC OFF")).toBeVisible();

    fireEvent.click(stopButton());
    fireEvent.click(screen.getByText("RECORD ANOTHER"));
    fireEvent.click(screen.getByLabelText(/Include microphone audio/i, { selector: "input" }));
    await start();

    expect(mediaDevices().getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(screen.getByText("MIC ON")).toBeVisible();
  });
});

// ── /webcam-recorder ──────────────────────────────────────────────────────

async function renderWebcam() {
  await act(async () => {
    render(<WebcamRecorderUI />);
  });
}

describe("WebcamRecorderUI", () => {
  it("says the device list is withheld rather than rendering blank options", async () => {
    mediaDevices().enumerateDevices.mockResolvedValue([
      { kind: "videoinput", deviceId: "a", label: "", groupId: "g" },
      { kind: "videoinput", deviceId: "b", label: "", groupId: "g" },
      { kind: "audioinput", deviceId: "c", label: "", groupId: "g" },
    ]);
    await renderWebcam();

    expect(
      screen.getByText(
        "Camera names are hidden until you allow access once — start a recording and the names appear here.",
      ),
    ).toBeVisible();
    // No count: the note says the same thing whether the browser handed over
    // two real ids or one anonymous placeholder, and only one of those two
    // shapes carries a number worth printing.
    expect(document.body.textContent).not.toMatch(/cameras are attached/);
    // The blank-label devices are still selectable, but under a name the user
    // can tell apart — never an empty row.
    expect(screen.getByRole("option", { name: "Camera 1" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Camera 2" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "" })).toBeNull();
  });

  it("uses the real labels once permission has been granted", async () => {
    mediaDevices().enumerateDevices.mockResolvedValue([
      { kind: "videoinput", deviceId: "a", label: "FaceTime HD Camera", groupId: "g" },
    ]);
    await renderWebcam();
    expect(screen.getByRole("option", { name: "FaceTime HD Camera" })).toBeInTheDocument();
    expect(screen.queryByText(/names are hidden/)).toBeNull();
  });

  it("asks for the camera and the microphone in one call, and drops the mic when unticked", async () => {
    mediaDevices().getUserMedia.mockResolvedValue(fakeStream([CAMERA_TRACK(), MIC_TRACK()]));
    await renderWebcam();

    await start();
    expect(mediaDevices().getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: "user" },
      audio: true,
    });

    fireEvent.click(stopButton());
    fireEvent.click(screen.getByText("RECORD ANOTHER"));
    fireEvent.click(screen.getByLabelText(/Include microphone audio/i, { selector: "input" }));
    mediaDevices().getUserMedia.mockResolvedValue(fakeStream([CAMERA_TRACK()]));
    await start();

    expect(mediaDevices().getUserMedia).toHaveBeenLastCalledWith({
      video: { facingMode: "user" },
      audio: false,
    });
  });

  it("names a chosen device exactly and stops sending facingMode with it", async () => {
    mediaDevices().enumerateDevices.mockResolvedValue([
      { kind: "videoinput", deviceId: "cam-2", label: "Studio Cam", groupId: "g" },
    ]);
    mediaDevices().getUserMedia.mockResolvedValue(fakeStream([CAMERA_TRACK()]));
    await renderWebcam();

    fireEvent.change(screen.getByLabelText("Camera"), { target: { value: "cam-2" } });
    expect(screen.getByText("Ignored while a specific camera is chosen above.")).toBeVisible();

    await start();
    expect(mediaDevices().getUserMedia).toHaveBeenCalledWith({
      video: { deviceId: { exact: "cam-2" } },
      audio: true,
    });
  });

  it("mounts a live preview bound to the capture stream", async () => {
    const stream = fakeStream([CAMERA_TRACK(), MIC_TRACK()]);
    mediaDevices().getUserMedia.mockResolvedValue(stream);
    await renderWebcam();
    expect(screen.queryByLabelText("Live camera preview")).toBeNull();

    await start();
    const preview = screen.getByLabelText("Live camera preview") as HTMLVideoElement;
    expect(preview.srcObject).toBe(stream);
    expect(preview).toHaveAttribute("autoplay");
    expect(preview.muted).toBe(true);
  });

  it("has its own copy for a missing camera and one held by another app", async () => {
    mediaDevices().getUserMedia.mockRejectedValue(new DOMException("gone", "NotFoundError"));
    await renderWebcam();
    await start();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No camera or microphone was found. Connect one and start again.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    mediaDevices().getUserMedia.mockRejectedValue(new DOMException("busy", "NotReadableError"));
    await start();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The camera could not be opened — something else is usually already using it. Close the other app or tab and start again.",
    );
  });

  it("downloads webcam-recording-<timestamp> with the container the browser chose", async () => {
    // Mic on, so the stream really does carry the Opus track the note names.
    mediaDevices().getUserMedia.mockResolvedValue(fakeStream([CAMERA_TRACK(), MIC_TRACK()]));
    await renderWebcam();
    await start();
    await act(async () => {
      fireEvent.click(stopButton());
    });
    expect(downloadName()).toMatch(/^webcam-recording-.*\.webm$/);
    expect(screen.getByText("Your browser wrote this clip as VP9 + OPUS IN WEBM.")).toBeVisible();
  });

  it("names no audio codec in a clip recorded with the microphone off", async () => {
    /*
      `isTypeSupported` answers about the codec registry, not about the stream:
      it says yes to `vp9,opus` for a camera-only capture and the constructor
      takes it, so the page used to print "VP9 + OPUS IN WEBM" next to its own
      "MIC OFF" for a file measured (Chromium 148) to contain only a V_VP9
      track. The candidate list has to follow the tracks that were acquired.
    */
    FakeMediaRecorder.supported = new Set(["video/webm;codecs=vp9,opus", "video/webm;codecs=vp9"]);
    mediaDevices().getUserMedia.mockResolvedValue(fakeStream([CAMERA_TRACK()]));
    await renderWebcam();
    fireEvent.click(screen.getByLabelText(/Include microphone audio/i, { selector: "input" }));

    await start();
    expect(mediaDevices().getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: "user" },
      audio: false,
    });
    expect(FakeMediaRecorder.instances[0].mimeType).toBe("video/webm;codecs=vp9");
    expect(screen.getByText("MIC OFF")).toBeVisible();

    await act(async () => {
      fireEvent.click(stopButton());
    });
    expect(screen.getByText("Your browser wrote this clip as VP9 IN WEBM.")).toBeVisible();
    expect(document.body.textContent).not.toMatch(/OPUS/);
    // The container is unaffected: still a WebM, still named one.
    expect(createdBlobs.at(-1)!.type).toBe("video/webm");
    expect(downloadName()).toMatch(/\.webm$/);
  });

  it("does not offer, or count, the browser's pre-permission placeholder", async () => {
    /*
      Measured in all three engines with no grant: ONE entry per kind, with
      deviceId, label and groupId all empty. It means "at least one of these
      exists" — a machine with three cameras returns exactly the same list.
      Rendered as an option it duplicates "Browser default" (same empty value,
      so React re-selects the first one and the row does nothing); counted, it
      asserts a number about the user's hardware that nobody measured.
    */
    mediaDevices().enumerateDevices.mockResolvedValue([
      { kind: "videoinput", deviceId: "", label: "", groupId: "" },
      { kind: "audioinput", deviceId: "", label: "", groupId: "" },
    ]);
    await renderWebcam();

    expect(screen.queryByRole("option", { name: "Camera 1" })).toBeNull();
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "Browser default" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/camera is attached|cameras are attached/);
    expect(
      screen.getByText(
        "Camera names are hidden until you allow access once — start a recording and the names appear here.",
      ),
    ).toBeVisible();
  });

  it("opens the camera once for a double-click inside the getUserMedia window", async () => {
    const gate = deferred<MediaStream>();
    mediaDevices().getUserMedia.mockReturnValue(gate.promise);
    await renderWebcam();

    act(() => {
      const button = startButton();
      fireEvent.click(button);
      fireEvent.click(button);
    });
    // After one grant there is no prompt at all, so this window is nothing but
    // the camera's cold-open latency — and a second camera stream opened here
    // is the one nothing ever stops.
    expect(mediaDevices().getUserMedia).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate.resolve(fakeStream([CAMERA_TRACK(), MIC_TRACK()]));
      await gate.promise;
    });
    expect(FakeMediaRecorder.instances).toHaveLength(1);
  });

  it("says the picture and the recording start together, because they do", async () => {
    // The preview is gated on `status`, which `recorder.start()` precedes:
    // there is no state with a live picture and nothing being captured, so the
    // idle hint must not promise a framing stage.
    mediaDevices().getUserMedia.mockResolvedValue(fakeStream([CAMERA_TRACK(), MIC_TRACK()]));
    await renderWebcam();
    expect(
      screen.getByText(
        "Start recording and your browser will ask to use the camera. The picture and the recording start together — nothing is captured before that.",
      ),
    ).toBeVisible();
    expect(document.body.textContent).not.toMatch(/picture appears here first/);
    expect(screen.queryByLabelText("Live camera preview")).toBeNull();
  });
});

// ── /audio-recorder ───────────────────────────────────────────────────────

async function renderAudio() {
  await act(async () => {
    render(<AudioRecorderUI />);
  });
}

describe("AudioRecorderUI", () => {
  it("denies MP3 outright and never hands one over", async () => {
    /*
      "Audio recorder" is a search term people arrive at expecting an MP3, and
      this page has no encoder in it at all. The denial is deliberate copy; the
      thing that must never appear is a *claim* — an `.mp3` file name, or a
      format line naming a codec the recorder did not report.
    */
    FakeMediaRecorder.supported = new Set(["audio/webm;codecs=opus"]);
    mediaDevices().getUserMedia.mockResolvedValue(fakeStream([MIC_TRACK()]));
    await renderAudio();
    expect(document.body.textContent).toContain("which is not an MP3");

    await start();
    await act(async () => {
      fireEvent.click(stopButton());
    });
    expect(downloadName()).not.toMatch(/\.mp3$/i);
    expect(document.body.textContent).not.toMatch(/\.mp3\b/i);
    expect(screen.getByText("Your browser wrote this recording as OPUS IN WEBM.")).toBeVisible();
  });

  it("asks for audio only — no video track is ever requested", async () => {
    FakeMediaRecorder.supported = new Set(["audio/webm;codecs=opus"]);
    mediaDevices().getUserMedia.mockResolvedValue(fakeStream([MIC_TRACK()]));
    await renderAudio();
    await start();
    expect(mediaDevices().getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(screen.queryByLabelText("Live camera preview")).toBeNull();
  });

  it("plays the clip back through <audio> and names it audio-recording-…", async () => {
    FakeMediaRecorder.supported = new Set(["audio/webm;codecs=opus"]);
    mediaDevices().getUserMedia.mockResolvedValue(fakeStream([MIC_TRACK()]));
    await renderAudio();
    await start();
    await act(async () => {
      fireEvent.click(stopButton());
    });

    expect(downloadName()).toMatch(/^audio-recording-.*\.webm$/);
    expect(document.querySelector("audio")).not.toBeNull();
    expect(document.querySelector("video")).toBeNull();
  });

  it("does not offer, or count, the browser's pre-permission placeholder", async () => {
    mediaDevices().enumerateDevices.mockResolvedValue([
      { kind: "audioinput", deviceId: "", label: "", groupId: "" },
    ]);
    await renderAudio();

    expect(screen.queryByRole("option", { name: "Microphone 1" })).toBeNull();
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(
      /microphone is attached|microphones are attached/,
    );
    expect(
      screen.getByText(
        "Microphone names are hidden until you allow access once — start a recording and the names appear here.",
      ),
    ).toBeVisible();
  });

  it("still names the devices it can actually select", async () => {
    // The other pre-permission shape: real ids, blank labels. Those ARE
    // selectable, so they stay in the list under a name you can tell apart.
    mediaDevices().enumerateDevices.mockResolvedValue([
      { kind: "audioinput", deviceId: "a", label: "", groupId: "g" },
      { kind: "audioinput", deviceId: "b", label: "", groupId: "g" },
    ]);
    await renderAudio();

    expect(screen.getByRole("option", { name: "Microphone 1" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Microphone 2" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "" })).toBeNull();
  });

  it("opens the microphone once for a double-click inside the getUserMedia window", async () => {
    FakeMediaRecorder.supported = new Set(["audio/webm;codecs=opus"]);
    const gate = deferred<MediaStream>();
    mediaDevices().getUserMedia.mockReturnValue(gate.promise);
    await renderAudio();

    act(() => {
      const button = startButton();
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(mediaDevices().getUserMedia).toHaveBeenCalledTimes(1);

    const mic = MIC_TRACK();
    await act(async () => {
      gate.resolve(fakeStream([mic]));
      await gate.promise;
    });
    expect(FakeMediaRecorder.instances).toHaveLength(1);

    await act(async () => {
      fireEvent.click(stopButton());
    });
    // The mic indicator goes out with "Stop and save" — there is no second,
    // unreferenced stream left running behind it.
    expect(mic.stop).toHaveBeenCalledTimes(1);
  });

  it("has its own refusal copy for a denied microphone", async () => {
    mediaDevices().getUserMedia.mockRejectedValue(new DOMException("no", "NotAllowedError"));
    await renderAudio();
    await start();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Microphone access was denied. Allow this site to use the microphone and start again.",
    );
  });
});
