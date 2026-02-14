import { access, constants, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { run } from "../exec";

/** Generate a unique artifact path under /tmp/pi-xcode/{kind}/. */
export async function makeDefaultArtifactPath(
  kind: "screenshots",
  extension: string,
): Promise<string> {
  const baseDir = join(tmpdir(), "pi-xcode", kind);
  await mkdir(baseDir, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-");
  const rand = Math.random().toString(36).slice(2, 8);
  return join(baseDir, `${stamp}-${rand}.${extension}`);
}

/** Try to parse JSON from runner stdout (handles log lines before JSON). */
export function parseRunnerJson(
  stdout: string,
): Record<string, unknown> | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : null;
  } catch {
    // Some runners may emit logs before the final JSON line.
    const lines = trimmed
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i];
      if (!line) continue;
      if (!line.startsWith("{") || !line.endsWith("}")) continue;
      try {
        const parsed = JSON.parse(line);
        if (isRecord(parsed)) return parsed;
      } catch {
        // keep scanning
      }
    }

    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toStringRecord(
  value: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}

/** Check if a CLI command is available and executable. */
export async function hasCommand(
  pi: ExtensionAPI,
  command: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const result = await run(
    pi,
    ["bash", "-lc", `command -v ${command}`],
    signal,
  );
  if (result.exitCode !== 0) return false;

  const path = result.stdout.trim();
  if (!path) return false;

  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
