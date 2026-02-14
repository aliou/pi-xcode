/**
 * Typed wrapper around macOS `osascript`.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { run } from "../utils/exec";

export async function evaluate(
  pi: ExtensionAPI,
  expression: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; output: string; stderr: string }> {
  const result = await run(pi, ["osascript", "-e", expression], signal);
  return {
    ok: result.exitCode === 0,
    output: result.stdout.trim(),
    stderr: result.stderr,
  };
}
