// Stub for Node.js-only modules (used by mupdf WASM in browser context)
const emptyModule = {};
export default emptyModule;
export function createRequire() { return () => null; }
