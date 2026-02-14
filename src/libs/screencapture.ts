/**
 * Typed wrapper around macOS `screencapture`.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { run } from "../utils/exec";

export async function capture(
  pi: ExtensionAPI,
  path: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; exitCode: number; stderr: string }> {
  const result = await run(pi, ["screencapture", "-x", path], signal);
  return {
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    stderr: result.stderr,
  };
}
