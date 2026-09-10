"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
  ToolSlider,
} from "@/components/tools/ToolAside";
import {
  CanvasHeader,
  CodeBlock,
  ColorStage,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN, MONO_LABEL } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { canvasToBlob } from "@/lib/tools/canvas-utils";
import {
  buildWifiPayload,
  checkWifiConfig,
  hasBlockingIssue,
  utf8Length,
  type WifiSecurity,
} from "@/lib/tools/wifi-qr";
import { cn } from "@/lib/utils/cn";
import { triggerDownload } from "@/lib/utils/download";

/** The one field box the redesign doc specifies, shared with the other text tools. */
const FIELD_CLASS =
  "h-[30px] rounded-[7px] border border-border bg-bg-elevated px-2.5 font-mono text-xs leading-none text-text-primary focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** Copied verbatim from QrCodeGeneratorUI so the two download rows match. */
const SECONDARY_BUTTON =
  "h-9 w-full cursor-pointer rounded-[9px] border border-border font-display text-[13px] leading-none font-medium text-neutral-300 transition-colors duration-200 hover:bg-text-primary/7 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

type ErrorCorrection = "L" | "M" | "Q" | "H";

const SECURITY_OPTIONS = [
  { value: "WPA" as const, label: "WPA/WPA2" },
  { value: "WEP" as const, label: "WEP" },
  { value: "nopass" as const, label: "Open" },
];

const EC_OPTIONS = [
  { value: "L" as const, label: "L" },
  { value: "M" as const, label: "M" },
  { value: "Q" as const, label: "Q" },
  { value: "H" as const, label: "H" },
];

const EC_NOTE: Record<ErrorCorrection, string> = {
  L: "Recovers about 7% damage. Smallest, densest code — fine on a screen.",
  M: "Recovers about 15%. The default, and the right choice for most printing.",
  Q: "Recovers about 25%. Worth it on a card that will live in a pocket.",
  H: "Recovers about 30%. Largest code for the same payload; survives a coffee ring.",
};

const SECURITY_LABEL: Record<WifiSecurity, string> = {
  WPA: "WPA/WPA2",
  WEP: "WEP",
  nopass: "OPEN",
};

export function WifiQrCodeUI() {
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [security, setSecurity] = useState<WifiSecurity>("WPA");
  const [hidden, setHidden] = useState(false);
  const [maskPassword, setMaskPassword] = useState(false);
  const [ecLevel, setEcLevel] = useState<ErrorCorrection>("M");
  const [size, setSize] = useState(320);
  const [fgColor, setFgColor] = useState("#000000");
  const [bgColor, setBgColor] = useState("#ffffff");
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { copied, copy } = useCopied();

  const config = useMemo(
    () => ({ ssid, password, security, hidden }),
    [ssid, password, security, hidden],
  );
  const payload = useMemo(() => buildWifiPayload(config), [config]);
  const issues = useMemo(() => checkWifiConfig(config), [config]);
  const blocked = hasBlockingIssue(issues);

  /*
    Which payload and which drawing options are actually ON the canvas.
    Clearing a `qrDataUrl` inside every one of the nine change handlers is how
    the sibling QR tool does it, and it is one forgotten handler away from a
    lit "READY" header over a code for the previous network — the single worst
    bug this page could ship. Comparing a key derived from the current state
    against the key the canvas was drawn with cannot be forgotten.
  */
  const renderKey = useMemo(
    () => JSON.stringify([payload, ecLevel, size, fgColor, bgColor]),
    [payload, ecLevel, size, fgColor, bgColor],
  );
  const [renderedKey, setRenderedKey] = useState("");
  const fresh = renderedKey !== "" && renderedKey === renderKey;

  /*
    The masked view is a real payload built from bullets, not a regex over the
    finished string: the P field can legitimately contain escaped semicolons
    and quotes, and a regex that tried to find its end would be the same class
    of bug the escaping exists to prevent. The length is preserved because
    seeing that you typed twelve characters is the point of looking.
  */
  const shownPayload =
    maskPassword && security !== "nopass" && password !== ""
      ? buildWifiPayload({ ...config, password: "•".repeat(password.length) })
      : payload;

  const handleGenerate = useCallback(async () => {
    setAttempted(true);
    setError("");
    setRenderedKey("");
    if (blocked) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      await QRCode.toCanvas(canvas, payload, {
        width: size,
        margin: 2,
        errorCorrectionLevel: ecLevel,
        color: { dark: fgColor, light: bgColor },
      });
      setRenderedKey(renderKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate the QR code");
    }
  }, [blocked, payload, size, ecLevel, fgColor, bgColor, renderKey]);

  const handleDownloadPng = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !fresh) return;
    try {
      const blob = await canvasToBlob(canvas, "image/png");
      triggerDownload(blob, `wifi-${ssid || "network"}.png`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to download the PNG");
    }
  }, [fresh, ssid]);

  const handleDownloadSvg = useCallback(async () => {
    if (!fresh) return;
    try {
      const svg = await QRCode.toString(payload, {
        type: "svg",
        margin: 2,
        width: size,
        errorCorrectionLevel: ecLevel,
        color: { dark: fgColor, light: bgColor },
      });
      const blob = new Blob([svg], { type: "image/svg+xml" });
      triggerDownload(blob, `wifi-${ssid || "network"}.svg`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to download the SVG");
    }
  }, [fresh, payload, size, ecLevel, fgColor, bgColor, ssid]);

  const handleCopyPayload = useCallback(() => {
    void copy(payload);
  }, [copy, payload]);

  /*
    Nothing is wrong yet on a page nobody has typed into. "Enter the network
    name" is an instruction, not an error, and rendering it under a red rule
    before the first keystroke would make every visit open on a failure.
  */
  const showIssues = attempted || ssid !== "" || password !== "";
  const errors = showIssues ? issues.filter((i) => i.level === "error") : [];
  const warnings = showIssues ? issues.filter((i) => i.level === "warning") : [];

  return (
    <>
      {/* ── Canvas: exactly what is encoded, then the code itself ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={ssid || "Wi-Fi QR code"}
          meta={`${SECURITY_LABEL[security]}${hidden ? " · HIDDEN" : ""}`}
          trailing={
            fresh
              ? `READY · ${size}×${size} PNG · SVG`
              : errors.length > 0
                ? "FIX THE ERRORS BELOW"
                : "PRESS GENERATE"
          }
        />

        {errors.map((issue) => (
          <ErrorMessage key={issue.id} message={issue.message} />
        ))}
        {error && <ErrorMessage message={error} />}
        {warnings.map((issue) => (
          <WarningMessage key={issue.id} message={issue.message} />
        ))}
        {fresh && security !== "nopass" && password !== "" && (
          <WarningMessage
            message={`This code contains the password in plain text — a QR code is a picture of a string, not an encryption of one. Anyone who scans the square above, photographs it, or screenshots this page joins the network. Nothing has been uploaded to get here, so the only copies that exist are the ones you make.`}
          />
        )}

        <CodeBlock
          label={maskPassword ? "Encoded payload · password masked in this view" : "Encoded payload"}
          action={
            <button
              onClick={handleCopyPayload}
              aria-label={copied ? "Copied payload" : "Copy payload"}
              className="cursor-pointer text-accent transition-colors hover:text-accent-hover"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          }
        >
          {shownPayload}
        </CodeBlock>

        <ColorStage checkered caption={fresh ? `scan target · ${ecLevel}` : "scan target"}>
          <canvas ref={canvasRef} className={fresh ? "max-h-full max-w-full rounded-[10px]" : "hidden"} />
          {!fresh && (
            <span className="px-6 text-center font-mono text-[10.5px] leading-[1.6] text-[rgba(22,24,38,.75)]">
              THE CODE APPEARS HERE ONCE YOU PRESS GENERATE
            </span>
          )}
        </ColorStage>
      </div>

      {/* ── Controls ────────────────────────────────────────────── */}
      <ToolAside
        footer={
          <>
            {/* Exactly one ToolActions on the page: it binds the global
                Cmd/Ctrl+Enter, and a second one would fight it. */}
            <ToolActions
              primaryLabel="Generate QR Code"
              onPrimary={handleGenerate}
              primaryDisabled={ssid === ""}
            />
            {fresh && (
              <>
                <button type="button" onClick={handleDownloadPng} className={SECONDARY_BUTTON}>
                  Download PNG
                </button>
                <button type="button" onClick={handleDownloadSvg} className={SECONDARY_BUTTON}>
                  Download SVG
                </button>
              </>
            )}
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="NETWORK NAME">
            <input
              type="text"
              value={ssid}
              onChange={(e) => setSsid(e.target.value)}
              placeholder="Guest Wi-Fi"
              aria-label="Network name (SSID)"
              autoComplete="off"
              spellCheck={false}
              className={cn(FIELD_CLASS, "w-full")}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              Case-sensitive, and encoded exactly as typed —{" "}
              {ssid === "" ? "0" : utf8Length(ssid)} of the 32 bytes 802.11 allows.
            </span>
          </ToolControl>

          <ToolControl label="SECURITY">
            <ToolChoice
              label="Security type"
              value={security}
              onChange={setSecurity}
              options={SECURITY_OPTIONS}
            />
          </ToolControl>

          {security !== "nopass" && (
            <ToolControl label="PASSWORD">
              <input
                type={maskPassword ? "password" : "text"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={security === "WEP" ? "10 or 26 hex digits" : "8 to 63 characters"}
                aria-label="Network password"
                autoComplete="off"
                spellCheck={false}
                className={cn(FIELD_CLASS, "w-full")}
              />
              <label className="flex cursor-pointer items-center gap-2.5 font-body text-[12.5px] text-neutral-300">
                <input
                  type="checkbox"
                  checked={maskPassword}
                  onChange={(e) => setMaskPassword(e.target.checked)}
                  className="size-4 rounded-sm border-border accent-accent"
                />
                Hide password characters
              </label>
              {/*
                The caveat appears the moment masking is switched on — which is
                the moment the "it must be safe now" misreading can form, and
                well before anything is generated or downloaded. Rendering it
                permanently costs the collapsed page ~48px to warn about a
                feature that is off.
              */}
              {maskPassword && (
                <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                  That masks this box and the payload text on the left. It does{" "}
                  <strong className="font-medium text-neutral-300">not</strong> change the code: the
                  square still encodes the real password, and Copy still copies it.
                </span>
              )}
            </ToolControl>
          )}

          <ToolControl label="VISIBILITY">
            <label className="flex cursor-pointer items-center gap-2.5 font-body text-[12.5px] text-neutral-300">
              <input
                type="checkbox"
                checked={hidden}
                onChange={(e) => setHidden(e.target.checked)}
                className="size-4 rounded-sm border-border accent-accent"
              />
              This network does not broadcast its name
            </label>
          </ToolControl>
        </ToolControlGroup>

        {/*
          The four appearance settings sit in a drawer, built like `ToolAdvanced`
          in ToolAside.tsx. None of them has to be touched to get a working code —
          M / 320px / black on white is the answer for almost every network — and
          open they cost 324px of reserved blank space above the fold on a phone,
          which the page has to hold empty until the UI mounts. Collapsed they are
          one click and still in the DOM, every word of the error-correction,
          size and contrast notes with them; the summary row shows the level and
          size actually in force, so nothing is silently in effect.
        */}
        <details className="group border-b border-border px-4">
          <summary className="flex cursor-pointer list-none items-center gap-2 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <span className={cn(MONO_LABEL, "text-text-muted")}>CODE</span>
            <span className="font-mono text-[10px] leading-none text-text-muted opacity-60">
              {ecLevel} · {size} PX · 4 SETTINGS
            </span>
            <span
              aria-hidden="true"
              className="ml-auto font-mono text-[15px] leading-none text-text-muted transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none"
            >
              ›
            </span>
          </summary>
          <div className="-mx-4 flex animate-tm-drawer flex-col gap-[9px] border-t border-border bg-text-primary/3 px-4 py-3.5 motion-reduce:animate-none">
            <ToolChoice
              label="Error correction level"
              value={ecLevel}
              onChange={setEcLevel}
              options={EC_OPTIONS}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {EC_NOTE[ecLevel]}
            </span>
            <ToolSlider
              label="Size"
              display={`${size} px`}
              min={128}
              max={1024}
              step={32}
              value={size}
              onChange={setSize}
              hint="Applies to the PNG. The SVG is vector, so it prints crisply at any size."
            />
            <label className="flex items-center justify-between gap-3 font-body text-[12.5px] text-neutral-300">
              Foreground
              <input
                type="color"
                value={fgColor}
                onChange={(e) => setFgColor(e.target.value)}
                className="size-8 cursor-pointer rounded-sm border border-border"
              />
            </label>
            <label className="flex items-center justify-between gap-3 font-body text-[12.5px] text-neutral-300">
              Background
              <input
                type="color"
                value={bgColor}
                onChange={(e) => setBgColor(e.target.value)}
                className="size-8 cursor-pointer rounded-sm border border-border"
              />
            </label>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              Keep the contrast high and the foreground darker than the background — most scanners
              refuse an inverted code.
            </span>
          </div>
        </details>

        <ToolAsideSection label="WHAT ENDS UP ON SCREEN">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            The password is drawn into the code above in plain text. Anyone who photographs that
            square or screenshots this page has your Wi-Fi password, and no camera app asks
            permission first. Nothing is uploaded — the payload is assembled and the code drawn in
            this tab, so the password does not cross the network to get here — but a printed code
            taped to a wall is a printed password. Point it at a guest network where you can.
          </span>
          <ToolOutput
            rows={[
              ["Payload", `${payload.length} chars`],
              ["Encodes", security === "nopass" ? "SSID only" : "SSID + password"],
              ["State", fresh ? "Generated" : "Not generated"],
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
