import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createReadTool } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { formatErrors, parseData, relPath } from "../components/render-helpers";
import { XcodeToolCall } from "../components/XcodeToolCall";
import { XcodeToolResult } from "../components/XcodeToolResult";
import { configLoader } from "../config";
import {
  err,
  formatResult,
  validateAction,
  type XcodeToolError,
} from "../utils/errors";
import {
  executeUiBackendAction,
  type UiBackendMode,
  type UiBackendName,
} from "../utils/ui-backend";

const UI_ACTIONS = [
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
  "screenshot",
  "video_start",
  "video_stop",
  "logs_start",
  "logs_stop",
  "crash_list",
  "crash_export",
  "export_report",
] as const;

const INTERACTIVE_ACTIONS = new Set<UiAction>([
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

const Params = Type.Object({
  action: StringEnum(UI_ACTIONS),
  backend: Type.Optional(
    StringEnum(["auto", "xcuitest", "idb", "axorcist"] as const),
  ),
  deviceId: Type.Optional(Type.String()),
  application: Type.Optional(
    Type.String({
      description:
        "Target application name or bundle id. Required for backend=axorcist (macOS native app automation).",
    }),
  ),
  runnerCommand: Type.Optional(Type.String()),
  params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

type UiAction = (typeof UI_ACTIONS)[number];

interface ToolParams {
  action: UiAction;
  backend?: UiBackendMode;
  deviceId?: string;
  application?: string;
  runnerCommand?: string;
  params?: Record<string, unknown>;
}

function buildUiSummary(
  action: UiAction,
  result: {
    ok: boolean;
    artifacts?: Record<string, string>;
    errors?: XcodeToolError[];
  },
): string {
  if (!result.ok) {
    const code = result.errors?.[0]?.code;
    return code ? `${action} failed (${code})` : `${action} failed`;
  }

  if (action === "screenshot") {
    const path = result.artifacts?.screenshot;
    if (path) return `screenshot ok: ${path}`;
  }

  if (action === "export_report") {
    const path = result.artifacts?.report;
    if (path) return `export_report ok: ${path}`;
  }

  if (action === "crash_export") {
    const path = result.artifacts?.crash;
    if (path) return `crash_export ok: ${path}`;
  }

  return `${action} ok`;
}

function resolveRunnerCommand(
  explicitCommand: string | undefined,
  commands: Record<string, string>,
): string | undefined {
  if (explicitCommand) return explicitCommand;
  const entries = Object.entries(commands);
  if (entries.length === 0) return undefined;
  if (entries.length === 1) return entries[0][1];
  // Multiple entries: prefer "default" key
  if (commands.default) return commands.default;
  // Otherwise return first entry
  return entries[0][1];
}

export function registerXcodeUiTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "xcode_ui",
    label: "Xcode UI",
    description:
      "UI automation + observability for simulator workflows. default backend: xcuitest. supports backends: xcuitest, idb.",
    parameters: Params,

    async execute(_toolCallId, rawParams, signal) {
      const params = rawParams as ToolParams;

      const actionError = validateAction("xcode_ui", params.action, UI_ACTIONS);
      if (actionError) {
        return formatResult(
          String(params.action ?? "unknown"),
          "Invalid action",
          {
            ok: false,
            action: String(params.action ?? "unknown"),
            errors: [actionError],
          },
        );
      }

      const backend = (params.backend ?? "xcuitest") as UiBackendMode;
      const runnerCommand = resolveRunnerCommand(
        params.runnerCommand,
        configLoader.getConfig().uiRunnerCommands,
      );

      if (
        INTERACTIVE_ACTIONS.has(params.action) &&
        !runnerCommand &&
        backend !== "axorcist"
      ) {
        return formatResult(params.action, `${params.action} failed`, {
          ok: false,
          action: params.action,
          backend: backend === "auto" ? "xcuitest" : backend,
          errors: [
            err(
              "interactive xcode_ui action requires runnerCommand",
              "MISSING_RUNNER",
              "Configure with /xcode:setup or pass runnerCommand. For macOS native apps, use backend='axorcist'. Read skills/pi-xcode/references/ui-test-harness.md for simulator harness setup.",
            ),
          ],
        });
      }

      const result = await executeUiBackendAction(
        pi,
        {
          action: params.action,
          backendMode: backend,
          deviceId: params.deviceId,
          application: params.application,
          runnerCommand,
          params: params.params,
        },
        signal,
      );

      const toolResult = formatResult(
        params.action,
        buildUiSummary(params.action, result),
        {
          ok: result.ok,
          action: params.action,
          backend: result.backend,
          data: result.data,
          artifacts: result.artifacts,
          warnings: result.warnings,
          errors: result.errors,
        },
      );

      // For successful screenshots, read the image and append it to the
      // result so the model can see the screenshot without a second tool call.
      if (
        params.action === "screenshot" &&
        result.ok &&
        result.artifacts?.screenshot
      ) {
        try {
          const readTool = createReadTool(process.cwd());
          const readResult = await readTool.execute(
            _toolCallId,
            { path: result.artifacts.screenshot },
            signal,
          );
          const imageBlocks = readResult.content.filter(
            (c) => c.type === "image",
          );
          toolResult.content.push(...imageBlocks);
        } catch {
          // Non-fatal: screenshot file was saved, just couldn't inline it.
        }
      }

      return toolResult;
    },

    renderCall(rawArgs, theme) {
      const args = rawArgs as unknown as Record<string, string | undefined>;
      const fields: { label: string; value: string }[] = [
        { label: "Action", value: args.action ?? "" },
        { label: "Backend", value: args.backend ?? "xcuitest" },
      ];
      if (args.deviceId) fields.push({ label: "Device", value: args.deviceId });
      if (args.runnerCommand) {
        fields.push({ label: "Runner", value: args.runnerCommand });
      }
      const rawParams = (rawArgs as unknown as ToolParams).params;
      if (rawParams && Object.keys(rawParams).length > 0) {
        fields.push({
          label: "Params",
          value: JSON.stringify(rawParams, null, 2),
        });
      }
      return new XcodeToolCall({ label: "UI", fields }, theme);
    },

    renderResult(result, options, theme) {
      const details = result.details as
        | {
            ok?: boolean;
            action?: string;
            backend?: UiBackendName;
            warnings?: string[];
            errors?: XcodeToolError[];
            data?: unknown;
            artifacts?: Record<string, string>;
          }
        | undefined;

      const ok = details?.ok ?? false;
      const action = details?.action ?? "unknown";
      const data = parseData(details?.data);
      const artifacts = details?.artifacts ?? {};

      /** Assemble the expanded detail body, always appending warnings and errors. */
      function buildDetail(bodyParts: string[]): string {
        const warnText =
          details?.warnings && details.warnings.length > 0
            ? details.warnings.map((w) => `> ${w}`).join("\n")
            : "";
        const errText = formatErrors(details?.errors);
        return [...bodyParts, warnText, errText].filter(Boolean).join("\n\n");
      }

      /** Render a data record as a fenced JSON block. */
      function jsonBlock(d: Record<string, unknown> | null): string {
        if (!d) return "";
        return `\`\`\`json\n${JSON.stringify(d, null, 2)}\n\`\`\``;
      }

      let collapsed: string;
      let expanded: string;

      switch (action) {
        // ── screenshot ────────────────────────────────────────────────────
        case "screenshot": {
          const path =
            artifacts.screenshot ?? (data?.path as string | undefined) ?? "";
          collapsed = path
            ? `screenshot: \`${relPath(path)}\``
            : ok
              ? "screenshot ok"
              : "screenshot failed";
          expanded = buildDetail([path ? `**Path:** \`${path}\`` : ""]);
          break;
        }

        // ── describe_ui ───────────────────────────────────────────────────
        case "describe_ui": {
          type UiElement = {
            type?: string;
            label?: string;
            identifier?: string;
          };
          const elements: UiElement[] = Array.isArray(data?.elements)
            ? (data.elements as UiElement[])
            : [];
          const count =
            typeof data?.count === "number" ? data.count : elements.length;
          collapsed = `describe_ui: ${count} elements`;
          const shown = elements.slice(0, 30);
          const extra = elements.length - shown.length;
          const bullets = shown
            .map(
              (e) =>
                `- ${e.type ?? ""} ${e.label ?? ""} (\`${e.identifier ?? ""}\`)`,
            )
            .join("\n");
          const moreText = extra > 0 ? `\n... and ${extra} more` : "";
          expanded = buildDetail([bullets + moreText]);
          break;
        }

        // ── tap ───────────────────────────────────────────────────────────
        case "tap": {
          const identifier = (data?.identifier as string | undefined) ?? "";
          collapsed = identifier
            ? `tap: \`${identifier}\``
            : ok
              ? "tap ok"
              : "tap failed";
          expanded = buildDetail([jsonBlock(data)]);
          break;
        }

        // ── type ──────────────────────────────────────────────────────────
        case "type": {
          const identifier = (data?.identifier as string | undefined) ?? "";
          const n = data?.textLength as number | undefined;
          collapsed = identifier
            ? `type: \`${identifier}\`${n != null ? ` (${n} chars)` : ""}`
            : ok
              ? "type ok"
              : "type failed";
          expanded = buildDetail([jsonBlock(data)]);
          break;
        }

        // ── clear_text ────────────────────────────────────────────────────
        case "clear_text": {
          const identifier = (data?.identifier as string | undefined) ?? "";
          collapsed = identifier
            ? `clear_text: \`${identifier}\``
            : ok
              ? "clear_text ok"
              : "clear_text failed";
          expanded = buildDetail([jsonBlock(data)]);
          break;
        }

        // ── swipe ─────────────────────────────────────────────────────────
        case "swipe": {
          const identifier = (data?.identifier as string | undefined) ?? "";
          collapsed = identifier
            ? `swipe: \`${identifier}\``
            : ok
              ? "swipe ok"
              : "swipe failed";
          expanded = buildDetail([jsonBlock(data)]);
          break;
        }

        // ── scroll ────────────────────────────────────────────────────────
        case "scroll": {
          const identifier = (data?.identifier as string | undefined) ?? "";
          collapsed = identifier
            ? `scroll: \`${identifier}\``
            : ok
              ? "scroll ok"
              : "scroll failed";
          expanded = buildDetail([jsonBlock(data)]);
          break;
        }

        // ── query_text / query_controls ───────────────────────────────────
        case "query_text":
        case "query_controls": {
          type MatchElement = {
            type?: string;
            label?: string;
            identifier?: string;
          };
          const rawMatches: unknown[] = Array.isArray(data?.matches)
            ? (data.matches as unknown[])
            : Array.isArray(data?.elements)
              ? (data.elements as unknown[])
              : [];
          const matchCount =
            rawMatches.length > 0
              ? rawMatches.length
              : typeof data?.count === "number"
                ? data.count
                : 0;
          collapsed =
            matchCount > 0
              ? `${action}: ${matchCount} matches`
              : `${action}: no matches`;
          const bullets = rawMatches
            .map((e) => {
              if (typeof e === "string") return `- ${e}`;
              const el = e as MatchElement;
              return `- ${el.type ?? ""} ${el.label ?? ""} (\`${el.identifier ?? ""}\`)`;
            })
            .join("\n");
          expanded = buildDetail([bullets]);
          break;
        }

        // ── wait_for / assert ─────────────────────────────────────────────
        case "wait_for":
        case "assert": {
          const identifier = (data?.identifier as string | undefined) ?? "";
          collapsed = ok
            ? `assert ok: \`${identifier}\``
            : `assert failed: \`${identifier}\``;
          expanded = buildDetail([jsonBlock(data)]);
          break;
        }

        // ── video_start ───────────────────────────────────────────────────
        case "video_start": {
          const path =
            artifacts.video ?? (data?.path as string | undefined) ?? "";
          collapsed = path
            ? `recording: \`${relPath(path)}\``
            : "recording started";
          const pid = data?.pid;
          expanded = buildDetail(
            [
              path ? `**Path:** \`${path}\`` : "",
              pid != null ? `**PID:** ${pid}` : "",
            ].filter(Boolean),
          );
          break;
        }

        // ── video_stop ────────────────────────────────────────────────────
        case "video_stop": {
          const path =
            artifacts.video ?? (data?.path as string | undefined) ?? "";
          collapsed = "recording stopped";
          const pid = data?.pid;
          expanded = buildDetail(
            [
              path ? `**Path:** \`${relPath(path)}\`` : "",
              pid != null ? `**PID:** ${pid}` : "",
            ].filter(Boolean),
          );
          break;
        }

        // ── logs_start ────────────────────────────────────────────────────
        case "logs_start": {
          const path =
            artifacts.logs ?? (data?.path as string | undefined) ?? "";
          collapsed = path ? `recording: \`${relPath(path)}\`` : "logs started";
          const pid = data?.pid;
          expanded = buildDetail(
            [
              path ? `**Path:** \`${path}\`` : "",
              pid != null ? `**PID:** ${pid}` : "",
            ].filter(Boolean),
          );
          break;
        }

        // ── logs_stop ─────────────────────────────────────────────────────
        case "logs_stop": {
          const path =
            artifacts.logs ?? (data?.path as string | undefined) ?? "";
          collapsed = "recording stopped";
          const pid = data?.pid;
          expanded = buildDetail(
            [
              path ? `**Path:** \`${relPath(path)}\`` : "",
              pid != null ? `**PID:** ${pid}` : "",
            ].filter(Boolean),
          );
          break;
        }

        // ── crash_list ────────────────────────────────────────────────────
        case "crash_list": {
          const items: string[] = Array.isArray(data?.crashes)
            ? (data.crashes as string[])
            : Array.isArray(data?.items)
              ? (data.items as string[])
              : [];
          collapsed =
            items.length > 0
              ? `crash_list: ${items.length} crashes`
              : "crash_list: no crashes";
          const bullets = items.map((p) => `- \`${relPath(p)}\``).join("\n");
          expanded = buildDetail([bullets]);
          break;
        }

        // ── crash_export ──────────────────────────────────────────────────
        case "crash_export": {
          const path =
            artifacts.crash ?? (data?.path as string | undefined) ?? "";
          collapsed = path
            ? `crash_export: \`${relPath(path)}\``
            : ok
              ? "crash_export ok"
              : "crash_export failed";
          expanded = buildDetail([path ? `**Path:** \`${path}\`` : ""]);
          break;
        }

        // ── export_report ─────────────────────────────────────────────────
        case "export_report": {
          const path =
            artifacts.report ?? (data?.path as string | undefined) ?? "";
          collapsed = path
            ? `export_report: \`${relPath(path)}\``
            : ok
              ? "export_report ok"
              : "export_report failed";
          expanded = buildDetail([path ? `**Path:** \`${path}\`` : ""]);
          break;
        }

        // ── fallback ──────────────────────────────────────────────────────
        default: {
          collapsed = ok ? `${action} ok` : `${action} failed`;
          expanded = buildDetail([jsonBlock(data)]);
          break;
        }
      }

      return new XcodeToolResult(
        {
          summary: collapsed,
          succeeded: ok,
          detail: expanded || undefined,
        },
        options,
        theme,
      );
    },
  });
}
