/**
 * One owner count for `document.body.style.overflow`.
 *
 * Two overlays can be open at once — on a phone the navbar's search icon sits
 * above the full-screen nav drawer, so tapping it opens the command palette
 * with the drawer still up. When each overlay wrote `overflow` directly, the
 * first one to close released the lock for both and the page scrolled behind
 * the drawer that was still covering it.
 *
 * Every overlay calls `lockScroll()` on open and `unlockScroll()` on close;
 * the body is only released when the last owner lets go.
 */

let owners = 0;

export function lockScroll(): void {
  if (owners++ === 0) document.body.style.overflow = "hidden";
}

export function unlockScroll(): void {
  owners -= 1;
  if (owners <= 0) {
    // Clamp rather than go negative: an unbalanced release must not make the
    // next `lockScroll()` a no-op.
    owners = 0;
    document.body.style.overflow = "";
  }
}

/** Test-only reset — the count is module state and leaks between cases. */
export function __resetScrollLock(): void {
  owners = 0;
}
