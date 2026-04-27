// scripts/cli.js
export function getArg(name, fallback = null) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : fallback;
}

export function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

export function requireArg(name) {
  const val = getArg(name);
  if (!val) throw new Error(`Missing required arg: --${name}`);
  return val;
}

export function getTimeoutMs(fallback = 10000) {
  const raw = getArg("timeout-ms", String(fallback));
  const timeoutMs = Number(raw);

  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) {
    throw new Error("--timeout-ms must be a number >= 1000");
  }

  return timeoutMs;
}

export function getHeadless(defaultValue = false) {
  const headless = hasFlag("headless");
  const headed = hasFlag("headed");

  if (headless && headed) {
    throw new Error("Use only one of --headless or --headed");
  }

  if (headless) return true;
  if (headed) return false;
  return defaultValue;
}