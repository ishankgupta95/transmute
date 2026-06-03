/**
 * Copy text to the clipboard, returning whether it actually succeeded.
 *
 * `navigator.clipboard.writeText` rejects in insecure (non-HTTPS) contexts, when
 * the document isn't focused, or when permission is denied. Callers MUST only
 * show a "Copied!" confirmation when this resolves `true`, otherwise the UI lies
 * about a copy that never happened.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
