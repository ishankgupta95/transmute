// Baked at build time (the site rebuilds on every push, so this stays current).
const YEAR = new Date().getFullYear();

/** The footer's copyright year — a build-time constant, no client JS. */
export function Year() {
  return <>{YEAR}</>;
}
