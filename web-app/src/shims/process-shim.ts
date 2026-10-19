// Minimal `process` for browser libraries that probe process.env at runtime.
// Vite `define` already inlines the process.env.* keys the shared app uses;
// this catches any remaining dynamic lookups instead of throwing.
const g = globalThis as any;
if (!g.process) {
  g.process = { env: { NODE_ENV: import.meta.env.MODE } };
} else if (!g.process.env) {
  g.process.env = { NODE_ENV: import.meta.env.MODE };
}
// Node-style `global` probes (expo-modules-core's browser environment module
// reads global.nativeExtensions in dev) — alias it to the global object.
if (!g.global) {
  g.global = globalThis;
}
export {};
