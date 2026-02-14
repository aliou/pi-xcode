/**
 * UI backend dispatcher.
 * Routes xcode_ui actions to the appropriate backend:
 * - xcuitest / idb: runner-based (XCUITest harness)
 * - axorcist: macOS native app automation via AX APIs
 * Shared actions (screenshot, video, logs, crash) go to simctl-based impl
 * unless overridden by backend.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  axorcistSupportsAction,
  executeAxorcistAction,
} from "./backends/axorcist";
import { executeRunnerAction } from "./backends/runner";
import { executeSharedUiAction, SHARED_ACTIONS } from "./backends/shared";
import type {
  UiActionContext,
  UiActionResult,
  UiBackendMode,
  UiBackendName,
} from "./backends/types";
import { err } from "./errors";

// Re-export types so existing imports from "./ui-backend" keep working.
export type { UiActionContext, UiActionResult, UiBackendMode, UiBackendName };

const INTERACTIVE_ACTIONS = new Set([
  "tap",
  "type",
  "swipe",
  "scroll",
  "clear_text",
  "describe_ui",
  "query_text",
  "query_controls",
  "wait_for",
  "assert",
]);

const XCUITEST_ACTIONS = new Set([...SHARED_ACTIONS, ...INTERACTIVE_ACTIONS]);
const IDB_ACTIONS = new Set([...SHARED_ACTIONS, ...INTERACTIVE_ACTIONS]);

export function resolveUiBackend(mode?: UiBackendMode): UiBackendName {
  if (!mode || mode === "auto") return "xcuitest";
  return mode;
}

export function backendSupportsAction(
  backend: UiBackendName,
  action: string,
): boolean {
  switch (backend) {
    case "xcuitest":
      return XCUITEST_ACTIONS.has(action);
    case "idb":
      return IDB_ACTIONS.has(action);
    case "axorcist":
      return axorcistSupportsAction(action);
    default:
      return false;
  }
}

export async function executeUiBackendAction(
  pi: ExtensionAPI,
  ctx: UiActionContext,
  signal?: AbortSignal,
): Promise<UiActionResult> {
  const backend = resolveUiBackend(ctx.backendMode);

  if (!backendSupportsAction(backend, ctx.action)) {
    return {
      ok: false,
      backend,
      errors: [
        err(`action '${ctx.action}' is not supported on backend '${backend}'`),
      ],
    };
  }

  // Axorcist handles everything itself (including screenshots via screencapture).
  if (backend === "axorcist") {
    return executeAxorcistAction(pi, ctx, signal);
  }

  // Shared actions (screenshot, video, logs, crash) use simctl directly.
  if (SHARED_ACTIONS.has(ctx.action)) {
    return executeSharedUiAction(pi, backend, ctx, signal);
  }

  // Interactive actions go through the runner.
  return executeRunnerAction(pi, backend, ctx, signal);
}
