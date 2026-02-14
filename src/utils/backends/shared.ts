/**
 * Shared UI actions that work across backends via simctl / system tools.
 * screenshot, video, logs, crash, export_report.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as simctl from "../../libs/simctl";
import { err } from "../errors";
import { run } from "../exec";
import { makeDefaultArtifactPath } from "./helpers";
import type { UiActionContext, UiActionResult, UiBackendName } from "./types";

export const SHARED_ACTIONS = new Set([
  "screenshot",
  "video_start",
  "video_stop",
  "logs_start",
  "logs_stop",
  "crash_list",
  "crash_export",
  "export_report",
]);

export async function executeSharedUiAction(
  pi: ExtensionAPI,
  backend: UiBackendName,
  ctx: UiActionContext,
  signal?: AbortSignal,
): Promise<UiActionResult> {
  const device = simctl.resolveDeviceTarget(ctx.deviceId);
  const p = ctx.params ?? {};

  if (ctx.action === "screenshot") {
    const path = p.path
      ? String(p.path)
      : await makeDefaultArtifactPath("screenshots", "png");
    const result = await simctl.screenshot(pi, device, path, signal);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        backend,
        errors: [
          err(result.stderr || result.stdout, "SIMCTL_SCREENSHOT_FAILED"),
        ],
      };
    }
    return {
      ok: true,
      backend,
      artifacts: { screenshot: path },
      data: { path },
    };
  }

  if (ctx.action === "video_start") {
    const path = String(p.path ?? "./xcode-ui-recording.mp4");
    const result = await simctl.recordVideo(pi, device, path, signal);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        backend,
        errors: [
          err(result.stderr || result.stdout, "SIMCTL_VIDEO_START_FAILED"),
        ],
      };
    }

    const pid = result.stdout.trim();
    return {
      ok: true,
      backend,
      artifacts: { video: path },
      data: { pid, path },
      warnings: [
        "video recording runs as background process. stop with video_stop.",
      ],
    };
  }

  if (ctx.action === "video_stop") {
    const pid = p.pid ? String(p.pid) : undefined;
    if (!pid) {
      return {
        ok: false,
        backend,
        errors: [err("video_stop requires pid", "MISSING_PID")],
      };
    }
    const result = await run(pi, ["kill", "-INT", pid], signal);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        backend,
        errors: [
          err(result.stderr || result.stdout, "SIMCTL_VIDEO_STOP_FAILED"),
        ],
      };
    }
    return { ok: true, backend, data: { pid } };
  }

  if (ctx.action === "logs_start") {
    const path = String(p.path ?? "./xcode-ui-device.log");
    const result = await simctl.logStream(pi, device, path, signal);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        backend,
        errors: [
          err(result.stderr || result.stdout, "LOG_STREAM_START_FAILED"),
        ],
      };
    }
    return {
      ok: true,
      backend,
      artifacts: { logs: path },
      data: { pid: result.stdout.trim(), path },
      warnings: ["log stream runs as background process. stop with logs_stop."],
    };
  }

  if (ctx.action === "logs_stop") {
    const pid = p.pid ? String(p.pid) : undefined;
    if (!pid) {
      return {
        ok: false,
        backend,
        errors: [err("logs_stop requires pid", "MISSING_PID")],
      };
    }
    const result = await run(pi, ["kill", "-INT", pid], signal);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        backend,
        errors: [err(result.stderr || result.stdout, "LOG_STREAM_STOP_FAILED")],
      };
    }
    return { ok: true, backend, data: { pid } };
  }

  if (ctx.action === "crash_list") {
    const result = await run(
      pi,
      [
        "bash",
        "-lc",
        "ls -1t ~/Library/Logs/DiagnosticReports/*.crash 2>/dev/null | head -n 20",
      ],
      signal,
    );
    const crashes = result.stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);
    return { ok: true, backend, data: { crashes } };
  }

  if (ctx.action === "crash_export") {
    const crashPath = p.crashPath ? String(p.crashPath) : "";
    const outputPath = p.outputPath
      ? String(p.outputPath)
      : "./crash-export.txt";
    if (!crashPath) {
      return {
        ok: false,
        backend,
        errors: [err("crash_export requires crashPath", "MISSING_CRASH_PATH")],
      };
    }

    const result = await run(pi, ["cp", crashPath, outputPath], signal);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        backend,
        errors: [err(result.stderr || result.stdout, "CRASH_EXPORT_FAILED")],
      };
    }

    return {
      ok: true,
      backend,
      artifacts: { crash: outputPath },
      data: { path: outputPath },
    };
  }

  if (ctx.action === "export_report") {
    const reportPath = String(p.path ?? "./xcode-ui-report.json");
    const payload = JSON.stringify(
      {
        backend,
        action: ctx.action,
        timestamp: new Date().toISOString(),
        steps: p.steps ?? [],
        artifacts: p.artifacts ?? {},
        verdict: p.verdict ?? "unknown",
      },
      null,
      2,
    );
    const result = await run(
      pi,
      [
        "bash",
        "-lc",
        `cat > '${reportPath.replaceAll("'", "'\\''")}' <<'EOF'\n${payload}\nEOF`,
      ],
      signal,
    );
    if (result.exitCode !== 0) {
      return {
        ok: false,
        backend,
        errors: [err(result.stderr || result.stdout, "REPORT_EXPORT_FAILED")],
      };
    }

    return {
      ok: true,
      backend,
      artifacts: { report: reportPath },
      data: { path: reportPath },
    };
  }

  return {
    ok: false,
    backend,
    errors: [err(`unsupported shared action '${ctx.action}'`)],
  };
}
