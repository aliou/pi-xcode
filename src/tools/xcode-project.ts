import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  formatErrors,
  inlineCodeList,
  parseData,
  pathList,
  relPath,
} from "../components/render-helpers";
import { XcodeToolCall } from "../components/XcodeToolCall";
import { XcodeToolResult } from "../components/XcodeToolResult";
import * as plist from "../libs/plist";
import * as xcodebuild from "../libs/xcodebuild";
import {
  err,
  formatResult,
  validateAction,
  type XcodeToolError,
} from "../utils/errors";
import { run } from "../utils/exec";
import { resolveProjectTarget } from "../utils/project-target";

const PROJECT_ACTIONS = [
  "discover_projects",
  "list_schemes",
  "show_build_settings",
  "get_bundle_id",
  "doctor",
] as const;

const Params = Type.Object({
  action: StringEnum(PROJECT_ACTIONS),
  directory: Type.Optional(Type.String()),
  maxDepth: Type.Optional(Type.Number({ minimum: 1, maximum: 10 })),
  projectPath: Type.Optional(Type.String()),
  workspacePath: Type.Optional(Type.String()),
  scheme: Type.Optional(Type.String()),
  configuration: Type.Optional(Type.String()),
  appPath: Type.Optional(Type.String()),
});

interface ToolParams {
  action: string;
  [key: string]: unknown;
}

export function registerXcodeProjectTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "xcode_project",
    label: "Xcode Project",
    description:
      "Project discovery and inspection. Actions: discover_projects, list_schemes, show_build_settings, get_bundle_id, doctor.",
    parameters: Params,

    async execute(_toolCallId, rawParams, signal) {
      const params = rawParams as ToolParams;

      const actionError = validateAction(
        "xcode_project",
        params.action,
        PROJECT_ACTIONS,
      );
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

      if (params.action === "discover_projects") {
        return discoverProjects(pi, params, signal);
      }

      if (params.action === "list_schemes") {
        return listSchemes(pi, params, signal);
      }

      if (params.action === "show_build_settings") {
        if (!params.scheme) {
          return formatResult(
            "show_build_settings",
            "Missing required argument",
            {
              ok: false,
              action: "show_build_settings",
              errors: [
                err(
                  "show_build_settings requires 'scheme'",
                  "VALIDATION_FAILED",
                ),
              ],
            },
          );
        }
        return showBuildSettings(pi, params, signal);
      }

      if (params.action === "get_bundle_id") {
        if (!params.appPath) {
          return formatResult("get_bundle_id", "Missing required argument", {
            ok: false,
            action: "get_bundle_id",
            errors: [
              err("get_bundle_id requires 'appPath'", "VALIDATION_FAILED"),
            ],
          });
        }
        return getBundleId(pi, params, signal);
      }

      if (params.action === "doctor") {
        return doctor(pi, signal);
      }

      return formatResult("unknown", "Unsupported action", {
        ok: false,
        action: "unknown",
        errors: [err(`Unsupported action '${params.action}'`)],
      });
    },

    renderCall(args, theme) {
      const call = args as unknown as Record<string, string | undefined>;
      const fields: { label: string; value: string }[] = [
        { label: "Action", value: call.action ?? "unknown" },
      ];
      if (call.scheme) fields.push({ label: "Scheme", value: call.scheme });
      if (call.projectPath)
        fields.push({ label: "Project", value: call.projectPath });
      if (call.workspacePath)
        fields.push({ label: "Workspace", value: call.workspacePath });
      return new XcodeToolCall({ label: "Project", fields }, theme);
    },

    renderResult(result, options, theme) {
      const details = result.details as
        | {
            ok?: boolean;
            action?: string;
            data?: unknown;
            warnings?: string[];
            errors?: Array<{ message?: string; code?: string; hint?: string }>;
          }
        | undefined;

      const ok = details?.ok ?? false;
      const action = details?.action ?? "unknown";
      const data = parseData(details?.data);

      let summary: string;
      let detail: string;

      switch (action) {
        case "discover_projects": {
          const preferred = data?.preferred as string | null | undefined;
          const workspaces = (data?.workspaces as string[] | undefined) ?? [];
          const projects = (data?.projects as string[] | undefined) ?? [];
          const total = workspaces.length + projects.length;

          summary = preferred
            ? `preferred: \`${relPath(preferred)}\``
            : "no projects found";

          const lines: string[] = [`Found ${total} project entries`];
          if (workspaces.length > 0) {
            lines.push("", "**Workspaces**", pathList(workspaces));
          }
          if (projects.length > 0) {
            lines.push("", "**Projects**", pathList(projects));
          }
          if (preferred) {
            lines.push("", `**Preferred**: \`${relPath(preferred)}\``);
          }
          detail = lines.join("\n");
          break;
        }

        case "list_schemes": {
          const schemes = (data?.schemes as string[] | undefined) ?? [];
          const name = data?.name as string | undefined;
          const workspacePath = data?.workspacePath as string | undefined;
          const projectPath = data?.projectPath as string | undefined;

          summary =
            schemes.length > 0 ? inlineCodeList(schemes) : "no schemes found";

          const schemeCount = schemes.length;
          const schemeLabel = `${schemeCount} scheme${schemeCount !== 1 ? "s" : ""}`;
          const header = name ? `${name}: ${schemeLabel}` : schemeLabel;
          const lines: string[] = [header];
          if (workspacePath) {
            lines.push("", `**Workspace**: \`${relPath(workspacePath)}\``);
          }
          if (projectPath) {
            lines.push("", `**Project**: \`${relPath(projectPath)}\``);
          }
          if (schemes.length > 0) {
            lines.push("", schemes.map((s) => `- \`${s}\``).join("\n"));
          }
          detail = lines.join("\n");
          break;
        }

        case "show_build_settings": {
          const settings =
            (data?.settings as
              | Array<{
                  target?: string;
                  buildSettings?: Record<string, string>;
                }>
              | undefined) ?? [];
          const bs = settings[0]?.buildSettings ?? {};
          const bundleId = bs.PRODUCT_BUNDLE_IDENTIFIER;

          summary = bundleId ?? "settings retrieved";

          const KEY_SETTINGS = [
            "PRODUCT_BUNDLE_IDENTIFIER",
            "TARGET_BUILD_DIR",
            "FULL_PRODUCT_NAME",
          ] as const;
          const lines: string[] = ["**Build Settings**"];
          for (const key of KEY_SETTINGS) {
            if (bs[key]) {
              lines.push(`- **${key}**: \`${bs[key]}\``);
            }
          }
          detail = lines.join("\n");
          break;
        }

        case "get_bundle_id": {
          const bundleId = data?.bundleId as string | undefined;
          const appPath = data?.appPath as string | undefined;

          summary = bundleId ? `\`${bundleId}\`` : "bundle id not found";

          const lines: string[] = [];
          if (bundleId) lines.push(`**Bundle ID**: \`${bundleId}\``);
          if (appPath) lines.push(`**App Path**: \`${relPath(appPath)}\``);
          detail = lines.join("\n");
          break;
        }

        case "doctor": {
          const checks =
            (data?.checks as
              | Array<{ command: string; ok: boolean; output: string }>
              | undefined) ?? [];
          const failedCount = checks.filter((c) => !c.ok).length;

          summary =
            failedCount === 0
              ? "toolchain ok"
              : `${failedCount} check(s) failed`;

          detail = checks
            .map((c) => `- ${c.ok ? "✅" : "❌"} \`${c.command}\``)
            .join("\n");
          break;
        }

        default: {
          summary = ok ? "ok" : "failed";
          detail = data
            ? `\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``
            : "";
          break;
        }
      }

      // Append formatted errors when present
      const errText = formatErrors(details?.errors);
      if (errText) {
        detail = detail ? `${detail}\n\n${errText}` : errText;
      }

      // Append warnings when present
      const warnings = details?.warnings ?? [];
      if (warnings.length > 0) {
        const warnText = warnings.map((w) => `> ⚠️ ${w}`).join("\n");
        detail = detail ? `${detail}\n\n${warnText}` : warnText;
      }

      return new XcodeToolResult(
        {
          summary,
          succeeded: ok,
          detail,
        },
        options,
        theme,
      );
    },
  });
}

async function discoverProjects(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const dir = String(params.directory ?? ".");
  const maxDepth = String(params.maxDepth ?? 6);

  const result = await run(
    pi,
    [
      "find",
      dir,
      "-maxdepth",
      maxDepth,
      "(",
      "-name",
      "*.xcodeproj",
      "-o",
      "-name",
      "*.xcworkspace",
      ")",
      "-not",
      "-path",
      "*/DerivedData/*",
      "-not",
      "-path",
      "*/build/*",
      "-not",
      "-path",
      "*/Pods/*",
      "-not",
      "-path",
      "*/.build/*",
      "-not",
      "-path",
      "*/node_modules/*",
      "-not",
      "-path",
      "*.xcodeproj/*",
    ],
    signal,
  );

  if (result.exitCode !== 0) {
    return formatResult("discover_projects", "Failed to discover projects", {
      ok: false,
      action: "discover_projects",
      errors: [err(result.stderr || result.stdout, "DISCOVER_FAILED")],
    });
  }

  const paths = result.stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .sort();

  const workspaces = paths.filter((path) => path.endsWith(".xcworkspace"));
  const projects = paths.filter((path) => path.endsWith(".xcodeproj"));

  return formatResult(
    "discover_projects",
    paths.length > 0
      ? `Found ${paths.length} project entries`
      : `No projects found in ${dir}`,
    {
      ok: true,
      action: "discover_projects",
      data: {
        paths,
        workspaces,
        projects,
        preferred: workspaces[0] ?? projects[0] ?? null,
      },
      warnings:
        paths.length === 0
          ? ["no workspace/project found in search scope"]
          : undefined,
    },
  );
}

async function listSchemes(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const targetResolution = await resolveProjectTarget(
    pi,
    getProjectTargetInput(params),
    signal,
  );

  if (!targetResolution.ok || !targetResolution.target) {
    return formatResult("list_schemes", "Failed to resolve project target", {
      ok: false,
      action: "list_schemes",
      errors: [
        formatTargetResolutionError(
          targetResolution.error,
          "LIST_SCHEMES_FAILED",
        ),
      ],
    });
  }

  const target = targetResolution.target;

  const result = await xcodebuild.list(
    pi,
    { projectPath: target.projectPath, workspacePath: target.workspacePath },
    signal,
  );
  if (result.exitCode !== 0) {
    return formatResult("list_schemes", "Failed to list schemes", {
      ok: false,
      action: "list_schemes",
      errors: [err(result.stderr || result.stdout, "LIST_SCHEMES_FAILED")],
      warnings: target.warnings,
    });
  }

  try {
    const parsed = JSON.parse(result.stdout) as {
      project?: { schemes?: string[]; name?: string };
      workspace?: { schemes?: string[]; name?: string };
    };

    const info = parsed.workspace ?? parsed.project;
    const schemes = info?.schemes ?? [];

    return formatResult("list_schemes", `Found ${schemes.length} scheme(s)`, {
      ok: true,
      action: "list_schemes",
      data: {
        schemes,
        name: info?.name,
        projectPath: target.projectPath,
        workspacePath: target.workspacePath,
      },
      warnings: target.warnings,
    });
  } catch {
    return formatResult("list_schemes", "Listed schemes (raw output)", {
      ok: true,
      action: "list_schemes",
      data: {
        raw: result.stdout.trim(),
        projectPath: target.projectPath,
        workspacePath: target.workspacePath,
      },
      warnings: [
        ...(target.warnings ?? []),
        "xcodebuild JSON parse failed. returned raw output.",
      ],
    });
  }
}

async function showBuildSettings(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const targetResolution = await resolveProjectTarget(
    pi,
    getProjectTargetInput(params),
    signal,
  );

  if (!targetResolution.ok || !targetResolution.target) {
    return formatResult(
      "show_build_settings",
      "Failed to resolve project target",
      {
        ok: false,
        action: "show_build_settings",
        errors: [
          formatTargetResolutionError(
            targetResolution.error,
            "BUILD_SETTINGS_FAILED",
          ),
        ],
      },
    );
  }

  const target = targetResolution.target;

  const result = await xcodebuild.showBuildSettings(
    pi,
    {
      projectPath: target.projectPath,
      workspacePath: target.workspacePath,
      scheme: String(params.scheme),
      configuration: params.configuration
        ? String(params.configuration)
        : undefined,
    },
    signal,
  );
  if (result.exitCode !== 0) {
    return formatResult("show_build_settings", "Failed to get build settings", {
      ok: false,
      action: "show_build_settings",
      errors: [err(result.stderr || result.stdout, "BUILD_SETTINGS_FAILED")],
      warnings: target.warnings,
    });
  }

  try {
    const settings = JSON.parse(result.stdout) as Array<{
      target?: string;
      buildSettings?: Record<string, string>;
    }>;

    const bundleId = settings[0]?.buildSettings?.PRODUCT_BUNDLE_IDENTIFIER;

    return formatResult(
      "show_build_settings",
      bundleId ? `Bundle: ${bundleId}` : "Build settings retrieved",
      {
        ok: true,
        action: "show_build_settings",
        data: {
          settings,
          projectPath: target.projectPath,
          workspacePath: target.workspacePath,
        },
        warnings: target.warnings,
      },
    );
  } catch {
    return formatResult(
      "show_build_settings",
      "Build settings retrieved (raw)",
      {
        ok: true,
        action: "show_build_settings",
        data: {
          raw: result.stdout.trim(),
          projectPath: target.projectPath,
          workspacePath: target.workspacePath,
        },
        warnings: [
          ...(target.warnings ?? []),
          "xcodebuild JSON parse failed. returned raw output.",
        ],
      },
    );
  }
}

async function getBundleId(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const appPath = String(params.appPath);
  const result = await plist.readValue(
    pi,
    `${appPath}/Info.plist`,
    "CFBundleIdentifier",
    signal,
  );

  if (!result.ok) {
    return formatResult("get_bundle_id", "Failed to read bundle identifier", {
      ok: false,
      action: "get_bundle_id",
      errors: [err(result.stderr || result.value, "BUNDLE_ID_READ_FAILED")],
    });
  }

  const bundleId = result.value;
  return formatResult("get_bundle_id", bundleId, {
    ok: true,
    action: "get_bundle_id",
    data: { bundleId },
  });
}

function getProjectTargetInput(params: ToolParams): {
  projectPath?: string;
  workspacePath?: string;
} {
  return {
    projectPath: params.projectPath as string | undefined,
    workspacePath: params.workspacePath as string | undefined,
  };
}

function formatTargetResolutionError(
  resolutionError:
    | {
        message: string;
        hint?: string;
        candidates?: string[];
      }
    | undefined,
  code: string,
): XcodeToolError {
  if (!resolutionError) {
    return err(
      "Failed to resolve project/workspace target",
      code,
      "Pass workspacePath or projectPath explicitly.",
    );
  }

  const candidateText = resolutionError.candidates?.length
    ? ` Candidates: ${resolutionError.candidates.join(", ")}`
    : "";

  return err(
    `${resolutionError.message}${candidateText}`,
    code,
    resolutionError.hint,
  );
}

async function doctor(pi: ExtensionAPI, signal?: AbortSignal) {
  const checks: Array<{ command: string; args: string[] }> = [
    { command: "xcodebuild", args: ["-version"] },
    { command: "xcrun", args: ["--version"] },
    { command: "xcrun", args: ["simctl", "help"] },
    { command: "xcrun", args: ["xcresulttool", "help"] },
  ];
  const rows: Array<{ command: string; ok: boolean; output: string }> = [];

  for (const check of checks) {
    const result = await run(pi, [check.command, ...check.args], signal);
    rows.push({
      command: `${check.command} ${check.args.join(" ")}`,
      ok: result.exitCode === 0,
      output: (result.stdout || result.stderr).trim(),
    });
  }

  const failed = rows.filter((row) => !row.ok);
  return formatResult(
    "doctor",
    failed.length === 0
      ? "Xcode toolchain available"
      : `${failed.length} dependency check(s) failed`,
    {
      ok: failed.length === 0,
      action: "doctor",
      data: { checks: rows },
      errors:
        failed.length > 0
          ? failed.map((f) =>
              err(`Missing dependency: ${f.command}`, "DOCTOR_FAILED"),
            )
          : undefined,
    },
  );
}
