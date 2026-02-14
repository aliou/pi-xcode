/**
 * Typed wrapper around PlistBuddy.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { run } from "../utils/exec";

export async function readValue(
  pi: ExtensionAPI,
  plistPath: string,
  key: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; value: string; stderr: string }> {
  const result = await run(
    pi,
    ["/usr/libexec/PlistBuddy", "-c", `Print :${key}`, plistPath],
    signal,
  );
  return {
    ok: result.exitCode === 0,
    value: result.stdout.trim(),
    stderr: result.stderr,
  };
}
