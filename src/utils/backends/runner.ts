/**
 * Runner-based backend for xcuitest and idb.
 * Sends a JSON payload to the runner command, parses JSON result.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { err } from "../errors";
import { run } from "../exec";
import {
  hasCommand,
  isRecord,
  parseRunnerJson,
  toStringRecord,
} from "./helpers";
import type { UiActionContext, UiActionResult, UiBackendName } from "./types";

export async function executeRunnerAction(
  pi: ExtensionAPI,
  backend: UiBackendName,
  ctx: UiActionContext,
  signal?: AbortSignal,
): Promise<UiActionResult> {
  if (!ctx.runnerCommand) {
    return {
      ok: false,
      backend,
      errors: [
        err(
          `action '${ctx.action}' requires a UI runner command`,
          "MISSING_RUNNER",
          "pass runnerCommand. example: runnerCommand='xcodebuild test -scheme <UITestScheme> -destination <dest>'",
        ),
      ],
      warnings: [
        "best practice: use an XCUITest runner harness. backend default is xcuitest.",
      ],
    };
  }

  if (backend === "idb") {
    const hasIdb = await hasCommand(pi, "idb", signal);
    if (!hasIdb) {
      return {
        ok: false,
        backend,
        errors: [
          err(
            "idb command not found",
            "IDB_NOT_FOUND",
            "install idb or use backend=xcuitest",
          ),
        ],
      };
    }
  }

  const payload = JSON.stringify({
    action: ctx.action,
    backend,
    deviceId: ctx.deviceId,
    params: ctx.params ?? {},
  });

  const shell = [
    "bash",
    "-lc",
    `${ctx.runnerCommand} '${payload.replaceAll("'", "'\\''")}'`,
  ];

  const result = await run(pi, shell, signal);

  // Try to parse JSON from stdout regardless of exit code.
  // The runner exits non-zero when ok=false (by design), but the
  // JSON result is still valid and contains structured errors.
  const parsed = parseRunnerJson(result.stdout);

  if (result.exitCode !== 0 && !parsed) {
    return {
      ok: false,
      backend,
      errors: [
        err(
          `ui runner failed: ${result.stderr || result.stdout || "no output"}`,
          "RUNNER_FAILED",
        ),
      ],
      data: {
        exitCode: result.exitCode,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
      },
    };
  }

  if (!parsed) {
    return {
      ok: false,
      backend,
      errors: [
        err(
          "ui runner returned non-json output",
          "RUNNER_INVALID_OUTPUT",
          "runner must print a single JSON result with at least { ok: boolean }",
        ),
      ],
      data: {
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
      },
    };
  }

  if (typeof parsed.ok !== "boolean") {
    return {
      ok: false,
      backend,
      errors: [
        err(
          "ui runner JSON missing boolean field 'ok'",
          "RUNNER_INVALID_JSON",
          "runner result must include { ok: true|false }",
        ),
      ],
      data: parsed,
    };
  }

  return {
    ok: parsed.ok,
    backend,
    data: parsed.data,
    artifacts: isRecord(parsed.artifacts)
      ? toStringRecord(parsed.artifacts)
      : undefined,
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((w): w is string => typeof w === "string")
      : undefined,
    errors: Array.isArray(parsed.errors)
      ? parsed.errors.map((e) => {
          if (typeof e === "string") return err(e);
          if (isRecord(e)) {
            return err(
              String(e.message ?? "runner error"),
              typeof e.code === "string" ? e.code : undefined,
              typeof e.hint === "string" ? e.hint : undefined,
            );
          }
          return err("runner error");
        })
      : parsed.ok
        ? undefined
        : [err("ui runner returned ok=false", "RUNNER_ACTION_FAILED")],
  };
}
