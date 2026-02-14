/**
 * Typed wrapper for inline Swift compilation + execution.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { type RunResult, run } from "../utils/exec";

export async function execute(
  pi: ExtensionAPI,
  swiftSource: string,
  signal?: AbortSignal,
): Promise<RunResult> {
  return run(
    pi,
    ["bash", "-lc", `swift - <<'SWIFT_EOF'\n${swiftSource}\nSWIFT_EOF`],
    signal,
  );
}
