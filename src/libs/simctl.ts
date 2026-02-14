/**
 * Typed wrapper around `xcrun simctl`.
 * Each function maps to a simctl subcommand, accepts typed inputs,
 * calls `run()` internally, and returns typed outputs.
 *
 * No Pi tool awareness: no formatResult, no XcodeToolError, no renderers.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { type RunResult, run } from "../utils/exec";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SimDevice {
  udid: string;
  name: string;
  state: string;
  runtime: string;
  isAvailable: boolean;
}

interface SimctlListOutput {
  devices?: Record<
    string,
    Array<{
      udid: string;
      name: string;
      state: string;
      isAvailable: boolean;
    }>
  >;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function resolveDeviceTarget(deviceId?: string): string {
  return deviceId ?? "booted";
}

async function simctlRaw(
  pi: ExtensionAPI,
  args: string[],
  signal?: AbortSignal,
): Promise<RunResult> {
  return run(pi, ["xcrun", "simctl", ...args], signal);
}

// ---------------------------------------------------------------------------
// Device listing
// ---------------------------------------------------------------------------

export async function listDevices(
  pi: ExtensionAPI,
  signal?: AbortSignal,
): Promise<{ ok: boolean; devices: SimDevice[]; stderr?: string }> {
  const result = await simctlRaw(pi, ["list", "devices", "--json"], signal);
  if (result.exitCode !== 0) {
    return { ok: false, devices: [], stderr: result.stderr || result.stdout };
  }

  try {
    const parsed: SimctlListOutput = JSON.parse(result.stdout);
    const devices: SimDevice[] = [];
    for (const [runtime, runtimeDevices] of Object.entries(
      parsed.devices ?? {},
    )) {
      for (const d of runtimeDevices) {
        devices.push({
          udid: d.udid,
          name: d.name,
          state: d.state,
          runtime,
          isAvailable: d.isAvailable,
        });
      }
    }
    return { ok: true, devices };
  } catch {
    return {
      ok: false,
      devices: [],
      stderr: "failed to parse simctl list devices --json",
    };
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function boot(
  pi: ExtensionAPI,
  deviceId: string,
  signal?: AbortSignal,
): Promise<RunResult> {
  return simctlRaw(pi, ["boot", deviceId], signal);
}

export async function bootStatus(
  pi: ExtensionAPI,
  deviceId: string,
  signal?: AbortSignal,
): Promise<RunResult> {
  return simctlRaw(pi, ["bootstatus", deviceId, "-b"], signal);
}

export async function shutdown(
  pi: ExtensionAPI,
  deviceId: string,
  signal?: AbortSignal,
): Promise<RunResult> {
  return simctlRaw(pi, ["shutdown", deviceId], signal);
}

export async function erase(
  pi: ExtensionAPI,
  deviceId: string,
  signal?: AbortSignal,
): Promise<RunResult> {
  return simctlRaw(pi, ["erase", deviceId], signal);
}

// ---------------------------------------------------------------------------
// App management
// ---------------------------------------------------------------------------

export async function install(
  pi: ExtensionAPI,
  deviceId: string,
  appPath: string,
  signal?: AbortSignal,
): Promise<RunResult> {
  return simctlRaw(pi, ["install", deviceId, appPath], signal);
}

export async function uninstall(
  pi: ExtensionAPI,
  deviceId: string,
  bundleId: string,
  signal?: AbortSignal,
): Promise<RunResult> {
  return simctlRaw(pi, ["uninstall", deviceId, bundleId], signal);
}

export async function launch(
  pi: ExtensionAPI,
  deviceId: string,
  bundleId: string,
  options?: { args?: string[]; env?: Record<string, string> },
  signal?: AbortSignal,
): Promise<RunResult> {
  const args = ["launch", deviceId, bundleId];

  if (options?.env) {
    for (const [key, value] of Object.entries(options.env)) {
      args.push("--env", `${key}=${value}`);
    }
  }

  if (options?.args && options.args.length > 0) {
    args.push("--args", ...options.args);
  }

  return simctlRaw(pi, args, signal);
}

export async function terminate(
  pi: ExtensionAPI,
  deviceId: string,
  bundleId: string,
  signal?: AbortSignal,
): Promise<RunResult> {
  return simctlRaw(pi, ["terminate", deviceId, bundleId], signal);
}

// ---------------------------------------------------------------------------
// I/O: screenshots & video
// ---------------------------------------------------------------------------

export async function screenshot(
  pi: ExtensionAPI,
  deviceId: string,
  path: string,
  signal?: AbortSignal,
): Promise<RunResult> {
  return simctlRaw(pi, ["io", deviceId, "screenshot", path], signal);
}

export async function recordVideo(
  pi: ExtensionAPI,
  deviceId: string,
  path: string,
  signal?: AbortSignal,
): Promise<RunResult> {
  return run(
    pi,
    [
      "bash",
      "-lc",
      `xcrun simctl io ${deviceId} recordVideo '${path.replaceAll("'", "'\\''")}' >/dev/null 2>&1 & echo $!`,
    ],
    signal,
  );
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export async function logStream(
  pi: ExtensionAPI,
  deviceId: string,
  path: string,
  signal?: AbortSignal,
): Promise<RunResult> {
  return run(
    pi,
    [
      "bash",
      "-lc",
      `xcrun simctl spawn ${deviceId} log stream --style compact > '${path.replaceAll("'", "'\\''")}' 2>&1 & echo $!`,
    ],
    signal,
  );
}

// ---------------------------------------------------------------------------
// Spawn
// ---------------------------------------------------------------------------

export async function spawn(
  pi: ExtensionAPI,
  deviceId: string,
  command: string[],
  signal?: AbortSignal,
): Promise<RunResult> {
  return simctlRaw(pi, ["spawn", deviceId, ...command], signal);
}

// ---------------------------------------------------------------------------
// Privacy / Location / UI / Biometrics
// ---------------------------------------------------------------------------

export async function privacy(
  pi: ExtensionAPI,
  deviceId: string,
  value: string,
  service: string,
  bundleId: string,
  signal?: AbortSignal,
): Promise<RunResult> {
  return simctlRaw(pi, ["privacy", deviceId, value, service, bundleId], signal);
}

export async function location(
  pi: ExtensionAPI,
  deviceId: string,
  lat: string,
  lon: string,
  signal?: AbortSignal,
): Promise<RunResult> {
  return simctlRaw(pi, ["location", deviceId, "set", lat, lon], signal);
}

export async function ui(
  pi: ExtensionAPI,
  deviceId: string,
  subcommand: string,
  value: string,
  signal?: AbortSignal,
): Promise<RunResult> {
  return simctlRaw(pi, ["ui", deviceId, subcommand, value], signal);
}

export async function biometric(
  pi: ExtensionAPI,
  deviceId: string,
  event: string,
  type: string,
  signal?: AbortSignal,
): Promise<RunResult> {
  return simctlRaw(pi, ["biometric", deviceId, event, type], signal);
}

// ---------------------------------------------------------------------------
// Container / App info
// ---------------------------------------------------------------------------

export async function getAppContainer(
  pi: ExtensionAPI,
  deviceId: string,
  bundleId: string,
  containerType?: string,
  signal?: AbortSignal,
): Promise<RunResult> {
  const args = ["get_app_container", deviceId, bundleId];
  if (containerType) args.push(containerType);
  return simctlRaw(pi, args, signal);
}

export async function listApps(
  pi: ExtensionAPI,
  deviceId: string,
  signal?: AbortSignal,
): Promise<RunResult> {
  return simctlRaw(pi, ["listapps", deviceId, "--json"], signal);
}

export async function appInfo(
  pi: ExtensionAPI,
  deviceId: string,
  bundleId: string,
  signal?: AbortSignal,
): Promise<RunResult> {
  return simctlRaw(pi, ["appinfo", deviceId, bundleId, "--json"], signal);
}

// ---------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------

export async function openUrl(
  pi: ExtensionAPI,
  deviceId: string,
  url: string,
  signal?: AbortSignal,
): Promise<RunResult> {
  return simctlRaw(pi, ["openurl", deviceId, url], signal);
}
