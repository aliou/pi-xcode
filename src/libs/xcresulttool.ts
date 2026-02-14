/**
 * Typed wrapper around `xcrun xcresulttool`.
 * Absorbs logic from `utils/xcresult.ts`.
 *
 * No Pi tool awareness: no formatResult, no XcodeToolError, no renderers.
 */
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { run } from "../utils/exec";

/**
 * Generate a unique temporary path for a .xcresult bundle.
 * Uses a UUID to avoid collisions (xcodebuild fails if path already exists).
 */
export function tempResultBundlePath(): string {
  return join(tmpdir(), `pi-xcode-${randomUUID()}.xcresult`);
}

/**
 * Parse build results from an .xcresult bundle.
 * Returns JSON string from `xcrun xcresulttool get build-results`.
 */
export async function getBuildResults(
  pi: ExtensionAPI,
  resultPath: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const result = await run(
    pi,
    ["xcrun", "xcresulttool", "get", "build-results", "--path", resultPath],
    signal,
  );
  if (result.exitCode !== 0) return null;
  return result.stdout;
}

/**
 * Parse test results summary from an .xcresult bundle.
 * Returns JSON string from `xcrun xcresulttool get test-results summary`.
 */
export async function getTestResults(
  pi: ExtensionAPI,
  resultPath: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const result = await run(
    pi,
    [
      "xcrun",
      "xcresulttool",
      "get",
      "test-results",
      "summary",
      "--path",
      resultPath,
    ],
    signal,
  );
  if (result.exitCode !== 0) return null;
  return result.stdout;
}

/**
 * Clean up a result bundle.
 */
export async function cleanupResultBundle(
  pi: ExtensionAPI,
  resultPath: string,
): Promise<void> {
  await run(pi, ["rm", "-rf", resultPath]);
}
