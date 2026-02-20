import { join } from "node:path";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { formatErrors, parseData, relPath } from "../components/render-helpers";
import { XcodeToolCall } from "../components/XcodeToolCall";
import { XcodeToolResult } from "../components/XcodeToolResult";
import * as simctl from "../libs/simctl";
import * as xcodebuild from "../libs/xcodebuild";
import * as xcresulttool from "../libs/xcresulttool";
import { createArtifactRunDir } from "../utils/artifacts";
import {
  err,
  formatResult,
  validateAction,
  type XcodeToolError,
} from "../utils/errors";
import { resolveProjectTarget } from "../utils/project-target";

const BUILD_ACTIONS = [
  "build",
  "test",
  "clean",
  "resolve_app_path",
  "parse_result_bundle",
  "report",
] as const;

const Params = Type.Object({
  action: StringEnum(BUILD_ACTIONS),
  projectPath: Type.Optional(Type.String()),
  workspacePath: Type.Optional(Type.String()),
  scheme: Type.Optional(Type.String()),
  platform: Type.Optional(
    StringEnum(["simulator", "device", "macos"] as const),
  ),
  configuration: Type.Optional(Type.String()),
  simulatorId: Type.Optional(Type.String()),
  deviceId: Type.Optional(Type.String()),
  derivedDataPath: Type.Optional(Type.String()),
  extraArgs: Type.Optional(Type.Array(Type.String())),
  resultBundlePath: Type.Optional(Type.String()),
  testType: Type.Optional(StringEnum(["unit", "ui"] as const)),
  testPlan: Type.Optional(Type.String()),
  install: Type.Optional(
    Type.Boolean({
      description:
        "After a successful build, install the app on the simulator. Requires platform=simulator (default). Resolves the .app path automatically.",
    }),
  ),
  launch: Type.Optional(
    Type.Boolean({
      description:
        "After a successful install, launch the app on the simulator. Implies install=true. Requires bundleId or resolves it from build settings.",
    }),
  ),
  bundleId: Type.Optional(
    Type.String({
      description:
        "Bundle identifier for launch. If omitted, resolved from build settings.",
    }),
  ),
});

interface ToolParams {
  action: string;
  [key: string]: unknown;
}

export function registerXcodeBuildTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "xcode_build",
    label: "Xcode Build",
    description:
      "Build, test, clean, and report actions. Actions: build, test, clean, resolve_app_path, parse_result_bundle, report.",
    parameters: Params,

    async execute(_toolCallId, rawParams, signal) {
      const params = rawParams as ToolParams;

      const actionError = validateAction(
        "xcode_build",
        params.action,
        BUILD_ACTIONS,
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

      if (params.action === "build") {
        if (!params.scheme) {
          return formatResult("build", "Missing required argument", {
            ok: false,
            action: "build",
            errors: [err("build requires 'scheme'", "VALIDATION_FAILED")],
          });
        }
        return build(pi, params, signal);
      }

      if (params.action === "test") {
        if (!params.scheme) {
          return formatResult("test", "Missing required argument", {
            ok: false,
            action: "test",
            errors: [err("test requires 'scheme'", "VALIDATION_FAILED")],
          });
        }
        return test(pi, params, signal);
      }

      if (params.action === "clean") {
        if (!params.scheme) {
          return formatResult("clean", "Missing required argument", {
            ok: false,
            action: "clean",
            errors: [err("clean requires 'scheme'", "VALIDATION_FAILED")],
          });
        }
        return clean(pi, params, signal);
      }

      if (params.action === "resolve_app_path") {
        if (!params.scheme) {
          return formatResult("resolve_app_path", "Missing required argument", {
            ok: false,
            action: "resolve_app_path",
            errors: [
              err("resolve_app_path requires 'scheme'", "VALIDATION_FAILED"),
            ],
          });
        }
        return resolveAppPath(pi, params, signal);
      }

      if (params.action === "parse_result_bundle") {
        if (!params.resultBundlePath) {
          return formatResult(
            "parse_result_bundle",
            "Missing required argument",
            {
              ok: false,
              action: "parse_result_bundle",
              errors: [
                err(
                  "parse_result_bundle requires 'resultBundlePath'",
                  "VALIDATION_FAILED",
                ),
              ],
            },
          );
        }
        return parseResultBundle(pi, params, signal);
      }

      if (params.action === "report") {
        if (!params.resultBundlePath) {
          return formatResult("report", "Missing required argument", {
            ok: false,
            action: "report",
            errors: [
              err("report requires 'resultBundlePath'", "VALIDATION_FAILED"),
            ],
          });
        }
        return report(pi, params, signal);
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
      if (call.platform)
        fields.push({ label: "Platform", value: call.platform });
      return new XcodeToolCall({ label: "Build", fields }, theme);
    },

    renderResult(result, options, theme) {
      const details = result.details as
        | {
            ok?: boolean;
            action?: string;
            warnings?: string[];
            errors?: XcodeToolError[];
            data?: unknown;
            artifacts?: Record<string, string>;
          }
        | undefined;

      const ok = details?.ok ?? false;
      const action = details?.action ?? "unknown";
      const data = parseData(details?.data);

      // Extract scheme and project/workspace from xcodebuild command array
      const command = Array.isArray(data?.command)
        ? (data.command as string[])
        : [];
      const schemeIdx = command.indexOf("-scheme");
      const scheme =
        schemeIdx >= 0 && command[schemeIdx + 1]
          ? command[schemeIdx + 1]
          : undefined;

      // Extract exit code from result text (e.g. "Build failed (exit 1)")
      const contentText =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      const exitCode = /\(exit (\d+)\)/.exec(contentText)?.[1];

      // Warnings rendered as blockquote lines
      const warningsBlock = details?.warnings?.length
        ? details.warnings.map((w) => `> [warn] ${w}`).join("\n")
        : "";

      // Errors rendered with formatErrors
      const errorsBlock = formatErrors(details?.errors);

      const detailParts: string[] = [];
      let summary: string;

      switch (action) {
        case "build": {
          const installed = data?.installed === true;
          const launched = data?.launched === true;
          const suffix = [
            installed ? "installed" : "",
            launched ? "launched" : "",
          ]
            .filter(Boolean)
            .join(" + ");

          summary = ok
            ? `build ok: \`${scheme ?? "unknown"}\`${suffix ? ` + ${suffix}` : ""}`
            : `build failed${exitCode ? ` (exit ${exitCode})` : ""}`;

          if (scheme) detailParts.push(`**Scheme**: \`${scheme}\``);

          const bundlePath =
            typeof data?.resultBundlePath === "string"
              ? data.resultBundlePath
              : undefined;
          if (bundlePath) {
            detailParts.push(`**Result bundle**: \`${relPath(bundlePath)}\``);
          }

          if (typeof data?.appPath === "string") {
            detailParts.push(
              `**App path**: \`${relPath(data.appPath as string)}\``,
            );
          }
          if (installed) detailParts.push("**Installed**: yes");
          if (launched) detailParts.push("**Launched**: yes");

          const parsed = parseData(data?.parsed);
          if (parsed) {
            const infoLines: string[] = [];
            if (parsed.status) infoLines.push(`Status: ${parsed.status}`);
            if (typeof parsed.errorCount === "number")
              infoLines.push(`Errors: ${parsed.errorCount}`);
            if (typeof parsed.warningCount === "number")
              infoLines.push(`Warnings: ${parsed.warningCount}`);
            if (infoLines.length) detailParts.push(infoLines.join(" · "));
          }
          break;
        }

        case "test": {
          summary = ok
            ? `tests passed: \`${scheme ?? "unknown"}\``
            : `tests failed${exitCode ? ` (exit ${exitCode})` : ""}`;

          if (scheme) detailParts.push(`**Scheme**: \`${scheme}\``);

          const bundlePath =
            typeof data?.resultBundlePath === "string"
              ? data.resultBundlePath
              : undefined;
          if (bundlePath) {
            detailParts.push(`**Result bundle**: \`${relPath(bundlePath)}\``);
          }

          const parsed = parseData(data?.parsed);
          if (parsed) {
            const infoLines: string[] = [];
            if (parsed.status) infoLines.push(`Status: ${parsed.status}`);
            if (typeof parsed.errorCount === "number")
              infoLines.push(`Errors: ${parsed.errorCount}`);
            if (typeof parsed.warningCount === "number")
              infoLines.push(`Warnings: ${parsed.warningCount}`);
            if (typeof parsed.passCount === "number")
              infoLines.push(`Passed: ${parsed.passCount}`);
            if (typeof parsed.failCount === "number")
              infoLines.push(`Failed: ${parsed.failCount}`);
            if (infoLines.length) detailParts.push(infoLines.join(" · "));
          }
          break;
        }

        case "clean": {
          summary = ok
            ? `clean ok: \`${scheme ?? "unknown"}\``
            : "clean failed";

          if (scheme) detailParts.push(`**Scheme**: \`${scheme}\``);

          const projectIdx = command.indexOf("-project");
          if (projectIdx >= 0 && command[projectIdx + 1]) {
            detailParts.push(
              `**Project**: \`${relPath(command[projectIdx + 1])}\``,
            );
          }
          const workspaceIdx = command.indexOf("-workspace");
          if (workspaceIdx >= 0 && command[workspaceIdx + 1]) {
            detailParts.push(
              `**Workspace**: \`${relPath(command[workspaceIdx + 1])}\``,
            );
          }
          break;
        }

        case "resolve_app_path": {
          const appPath = typeof data?.appPath === "string" ? data.appPath : "";
          summary = appPath
            ? `\`${relPath(appPath)}\``
            : ok
              ? "resolved"
              : "failed";

          if (appPath) {
            detailParts.push(`**App path**: \`${appPath}\``);
          }
          break;
        }

        case "parse_result_bundle":
        case "report": {
          summary = ok ? "report ok" : "report failed";

          // resultBundlePath lives in data for "report", in artifacts for "parse_result_bundle"
          const bundlePath =
            typeof data?.resultBundlePath === "string"
              ? data.resultBundlePath
              : typeof details?.artifacts?.resultBundle === "string"
                ? details.artifacts.resultBundle
                : undefined;
          if (bundlePath) {
            detailParts.push(`**Result bundle**: \`${relPath(bundlePath)}\``);
          }

          const buildData = parseData(data?.build);
          if (buildData) {
            const lines: string[] = ["**Build**:"];
            if (buildData.status) lines.push(`- Status: ${buildData.status}`);
            if (typeof buildData.errorCount === "number")
              lines.push(`- Errors: ${buildData.errorCount}`);
            if (typeof buildData.warningCount === "number")
              lines.push(`- Warnings: ${buildData.warningCount}`);
            detailParts.push(lines.join("\n"));
          }

          const testData = parseData(data?.test);
          if (testData) {
            const lines: string[] = ["**Test**:"];
            if (testData.status) lines.push(`- Status: ${testData.status}`);
            if (typeof testData.errorCount === "number")
              lines.push(`- Errors: ${testData.errorCount}`);
            if (typeof testData.warningCount === "number")
              lines.push(`- Warnings: ${testData.warningCount}`);
            if (typeof testData.passCount === "number")
              lines.push(`- Passed: ${testData.passCount}`);
            if (typeof testData.failCount === "number")
              lines.push(`- Failed: ${testData.failCount}`);
            detailParts.push(lines.join("\n"));
          }
          break;
        }

        default: {
          summary = ok ? "ok" : "failed";
          break;
        }
      }

      if (warningsBlock) detailParts.push(warningsBlock);
      if (errorsBlock) detailParts.push(errorsBlock);

      const detail = detailParts.join("\n\n");

      return new XcodeToolResult(
        {
          summary,
          succeeded: ok,
          detail: detail || undefined,
        },
        options,
        theme,
      );
    },
  });
}

async function build(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const platform = String(params.platform ?? "simulator");
  const artifactDir = await createArtifactRunDir("xcode-build");
  const resultBundlePath = String(
    params.resultBundlePath ?? join(artifactDir, "build.xcresult"),
  );

  const destinationId =
    platform === "simulator"
      ? (params.simulatorId as string | undefined)
      : platform === "device"
        ? (params.deviceId as string | undefined)
        : undefined;

  const targetResolution = await resolveProjectTarget(
    pi,
    getProjectTargetInput(params),
    signal,
  );

  if (!targetResolution.ok || !targetResolution.target) {
    return formatResult("build", "Failed to resolve project target", {
      ok: false,
      action: "build",
      errors: [formatTargetResolutionError(targetResolution.error)],
    });
  }

  const target = targetResolution.target;

  const destParts = xcodebuild.destinationArgs(platform, destinationId);
  const destination = destParts.length === 2 ? destParts[1] : undefined;

  const result = await xcodebuild.build(
    pi,
    {
      projectPath: target.projectPath,
      workspacePath: target.workspacePath,
      scheme: String(params.scheme),
      configuration: params.configuration as string | undefined,
      derivedDataPath: params.derivedDataPath as string | undefined,
      extraArgs: params.extraArgs as string[] | undefined,
      destination,
      resultBundlePath,
    },
    signal,
  );
  const buildOk = result.exitCode === 0;
  const parsed = await xcresulttool.getBuildResults(
    pi,
    resultBundlePath,
    signal,
  );
  const warnings = [...(target.warnings ?? [])];

  // Post-build: install + launch chain
  const wantInstall =
    buildOk && (params.install === true || params.launch === true);
  const wantLaunch = buildOk && params.launch === true;

  let appPath: string | undefined;
  let installOk = false;
  let launchOk = false;
  let postBuildErrors: XcodeToolError[] = [];

  if (wantInstall && platform === "simulator") {
    const resolved = await resolveAppPathString(
      pi,
      {
        projectPath: target.projectPath,
        workspacePath: target.workspacePath,
      },
      String(params.scheme),
      platform,
      destinationId,
      params.configuration as string | undefined,
      signal,
    );
    if (resolved.ok && resolved.appPath) {
      appPath = resolved.appPath;
      const device = simctl.resolveDeviceTarget(destinationId);
      const installResult = await simctl.install(pi, device, appPath, signal);
      if (installResult.exitCode === 0) {
        installOk = true;
        if (wantLaunch) {
          // Resolve bundleId if not provided
          let bid = params.bundleId as string | undefined;
          if (!bid) {
            bid = resolved.bundleId;
          }
          if (bid) {
            const launchResult = await simctl.launch(
              pi,
              device,
              bid,
              {},
              signal,
            );
            if (launchResult.exitCode === 0) {
              launchOk = true;
            } else {
              postBuildErrors = [
                err(
                  launchResult.stderr || "simctl launch failed",
                  "LAUNCH_FAILED",
                ),
              ];
            }
          } else {
            postBuildErrors = [
              err(
                "could not resolve bundleId for launch; pass bundleId explicitly",
                "LAUNCH_MISSING_BUNDLE_ID",
              ),
            ];
          }
        }
      } else {
        postBuildErrors = [
          err(
            installResult.stderr || "simctl install failed",
            "INSTALL_FAILED",
          ),
        ];
      }
    } else {
      postBuildErrors = [
        err(
          resolved.error ?? "could not resolve .app path for install",
          "APP_PATH_FAILED",
        ),
      ];
    }
  } else if (wantInstall && platform !== "simulator") {
    warnings.push(
      "install/launch flags are only supported for simulator builds",
    );
  }

  // Build summary line
  let summaryText = buildOk
    ? "Build succeeded"
    : `Build failed (exit ${result.exitCode})`;
  if (installOk) summaryText += " + installed";
  if (launchOk) summaryText += " + launched";

  const allErrors: XcodeToolError[] = [];
  if (!buildOk) {
    allErrors.push(
      err(result.stderr || result.stdout || "build failed", "BUILD_FAILED"),
    );
  }
  allErrors.push(...postBuildErrors);

  return formatResult("build", summaryText, {
    ok: buildOk && postBuildErrors.length === 0,
    action: "build",
    data: {
      command: result.command,
      stdout: result.stdout,
      stderr: result.stderr,
      resultBundlePath,
      parsed: parsed ? safeJson(parsed) : null,
      appPath,
      installed: installOk || undefined,
      launched: launchOk || undefined,
    },
    artifacts: { resultBundle: resultBundlePath },
    warnings: warnings.length > 0 ? warnings : undefined,
    errors: allErrors.length > 0 ? allErrors : undefined,
  });
}

async function test(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const platform = String(params.platform ?? "simulator");
  const artifactDir = await createArtifactRunDir("xcode-test");
  const resultBundlePath = String(
    params.resultBundlePath ?? join(artifactDir, "test.xcresult"),
  );

  const destinationId =
    platform === "simulator"
      ? (params.simulatorId as string | undefined)
      : platform === "device"
        ? (params.deviceId as string | undefined)
        : undefined;

  const targetResolution = await resolveProjectTarget(
    pi,
    getProjectTargetInput(params),
    signal,
  );

  if (!targetResolution.ok || !targetResolution.target) {
    return formatResult("test", "Failed to resolve project target", {
      ok: false,
      action: "test",
      errors: [formatTargetResolutionError(targetResolution.error)],
    });
  }

  const target = targetResolution.target;

  const destParts = xcodebuild.destinationArgs(platform, destinationId);
  const destination = destParts.length === 2 ? destParts[1] : undefined;

  const result = await xcodebuild.test(
    pi,
    {
      projectPath: target.projectPath,
      workspacePath: target.workspacePath,
      scheme: String(params.scheme),
      destination,
      configuration: params.configuration as string | undefined,
      derivedDataPath: params.derivedDataPath as string | undefined,
      resultBundlePath,
      testPlan: params.testPlan as string | undefined,
      testType: params.testType as "unit" | "ui" | undefined,
    },
    signal,
  );
  const ok = result.exitCode === 0;
  const parsed = await xcresulttool.getTestResults(
    pi,
    resultBundlePath,
    signal,
  );

  return formatResult(
    "test",
    ok ? "Tests passed" : `Tests failed (exit ${result.exitCode})`,
    {
      ok,
      action: "test",
      data: {
        command: result.command,
        stdout: result.stdout,
        stderr: result.stderr,
        resultBundlePath,
        parsed: parsed ? safeJson(parsed) : null,
      },
      artifacts: { resultBundle: resultBundlePath },
      warnings: target.warnings,
      errors: ok
        ? undefined
        : [err(result.stderr || result.stdout || "test failed", "TEST_FAILED")],
    },
  );
}

async function clean(
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
    return formatResult("clean", "Failed to resolve project target", {
      ok: false,
      action: "clean",
      errors: [formatTargetResolutionError(targetResolution.error)],
    });
  }

  const target = targetResolution.target;

  const result = await xcodebuild.clean(
    pi,
    {
      projectPath: target.projectPath,
      workspacePath: target.workspacePath,
      scheme: String(params.scheme),
    },
    signal,
  );
  const ok = result.exitCode === 0;

  return formatResult(
    "clean",
    ok ? "Clean succeeded" : `Clean failed (exit ${result.exitCode})`,
    {
      ok,
      action: "clean",
      data: {
        command: result.command,
        stdout: result.stdout,
        stderr: result.stderr,
      },
      warnings: target.warnings,
      errors: ok
        ? undefined
        : [
            err(
              result.stderr || result.stdout || "clean failed",
              "CLEAN_FAILED",
            ),
          ],
    },
  );
}

/**
 * Internal helper: resolve the .app path and bundle ID from build settings.
 * Used by both `resolve_app_path` action and post-build install/launch chain.
 */
async function resolveAppPathString(
  pi: ExtensionAPI,
  target: { projectPath?: string; workspacePath?: string },
  scheme: string,
  platform: string,
  destinationId: string | undefined,
  configuration: string | undefined,
  signal?: AbortSignal,
): Promise<{
  ok: boolean;
  appPath?: string;
  bundleId?: string;
  error?: string;
}> {
  const destParts = xcodebuild.destinationArgs(platform, destinationId);
  const destination = destParts.length === 2 ? destParts[1] : undefined;

  const result = await xcodebuild.showBuildSettings(
    pi,
    {
      projectPath: target.projectPath,
      workspacePath: target.workspacePath,
      scheme,
      destination,
      configuration,
    },
    signal,
  );
  if (result.exitCode !== 0) {
    return {
      ok: false,
      error: result.stderr || result.stdout || "showBuildSettings failed",
    };
  }

  try {
    const parsed = JSON.parse(result.stdout) as Array<{
      buildSettings?: Record<string, string>;
    }>;
    const bs = parsed[0]?.buildSettings;
    const buildDir = bs?.TARGET_BUILD_DIR;
    const productName = bs?.FULL_PRODUCT_NAME;
    const bundleId = bs?.PRODUCT_BUNDLE_IDENTIFIER;

    if (!buildDir || !productName) {
      return {
        ok: false,
        error: "TARGET_BUILD_DIR/FULL_PRODUCT_NAME missing from build settings",
      };
    }

    return { ok: true, appPath: join(buildDir, productName), bundleId };
  } catch {
    return { ok: false, error: "xcodebuild JSON parse failed" };
  }
}

async function resolveAppPath(
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
      "resolve_app_path",
      "Failed to resolve project target",
      {
        ok: false,
        action: "resolve_app_path",
        errors: [formatTargetResolutionError(targetResolution.error)],
      },
    );
  }

  const target = targetResolution.target;

  const platform = String(params.platform ?? "simulator");
  const destinationId =
    platform === "simulator"
      ? (params.simulatorId as string | undefined)
      : platform === "device"
        ? (params.deviceId as string | undefined)
        : undefined;

  const destParts = xcodebuild.destinationArgs(platform, destinationId);
  const destination = destParts.length === 2 ? destParts[1] : undefined;

  const result = await xcodebuild.showBuildSettings(
    pi,
    {
      projectPath: target.projectPath,
      workspacePath: target.workspacePath,
      scheme: String(params.scheme),
      destination,
      configuration: params.configuration as string | undefined,
    },
    signal,
  );
  if (result.exitCode !== 0) {
    return formatResult("resolve_app_path", "Failed to resolve app path", {
      ok: false,
      action: "resolve_app_path",
      warnings: target.warnings,
      errors: [
        err(
          result.stderr || result.stdout || "showBuildSettings failed",
          "APP_PATH_FAILED",
        ),
      ],
    });
  }

  try {
    const parsed = JSON.parse(result.stdout) as Array<{
      buildSettings?: Record<string, string>;
    }>;
    const bs = parsed[0]?.buildSettings;

    const buildDir = bs?.TARGET_BUILD_DIR;
    const productName = bs?.FULL_PRODUCT_NAME;

    if (!buildDir || !productName) {
      return formatResult("resolve_app_path", "Unable to resolve app path", {
        ok: false,
        action: "resolve_app_path",
        warnings: target.warnings,
        errors: [
          err("TARGET_BUILD_DIR/FULL_PRODUCT_NAME missing", "APP_PATH_MISSING"),
        ],
      });
    }

    const appPath = join(buildDir, productName);
    return formatResult("resolve_app_path", appPath, {
      ok: true,
      action: "resolve_app_path",
      data: { appPath },
      warnings: target.warnings,
    });
  } catch {
    return formatResult("resolve_app_path", "Unable to parse build settings", {
      ok: false,
      action: "resolve_app_path",
      warnings: target.warnings,
      errors: [err("xcodebuild JSON parse failed", "APP_PATH_PARSE_FAILED")],
    });
  }
}

async function parseResultBundle(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const resultBundlePath = String(params.resultBundlePath);
  const build = await xcresulttool.getBuildResults(
    pi,
    resultBundlePath,
    signal,
  );
  const test = await xcresulttool.getTestResults(pi, resultBundlePath, signal);

  if (!build && !test) {
    return formatResult(
      "parse_result_bundle",
      "Failed to parse result bundle",
      {
        ok: false,
        action: "parse_result_bundle",
        errors: [
          err(
            "xcresulttool could not parse build or test payload",
            "XCRESULT_PARSE_FAILED",
          ),
        ],
        artifacts: { resultBundle: resultBundlePath },
      },
    );
  }

  return formatResult("parse_result_bundle", "Parsed result bundle", {
    ok: true,
    action: "parse_result_bundle",
    data: {
      build: build ? safeJson(build) : null,
      test: test ? safeJson(test) : null,
    },
    artifacts: { resultBundle: resultBundlePath },
  });
}

async function report(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const resultBundlePath = String(params.resultBundlePath);
  const build = await xcresulttool.getBuildResults(
    pi,
    resultBundlePath,
    signal,
  );
  const test = await xcresulttool.getTestResults(pi, resultBundlePath, signal);

  const warnings: string[] = [];
  const errors: XcodeToolError[] = [];

  if (!build && !test) {
    errors.push(err("No build or test results parsed", "REPORT_PARSE_EMPTY"));
  }

  if (!build) {
    warnings.push("build payload missing in xcresult");
  }

  if (!test) {
    warnings.push("test payload missing in xcresult");
  }

  const ok = errors.length === 0;
  return formatResult(
    "report",
    ok ? "Result report generated" : "Result report failed",
    {
      ok,
      action: "report",
      data: {
        resultBundlePath,
        build: build ? safeJson(build) : null,
        test: test ? safeJson(test) : null,
      },
      artifacts: { resultBundle: resultBundlePath },
      warnings: warnings.length > 0 ? warnings : undefined,
      errors: errors.length > 0 ? errors : undefined,
    },
  );
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
): XcodeToolError {
  if (!resolutionError) {
    return err(
      "Failed to resolve project/workspace target",
      "PROJECT_TARGET_REQUIRED",
      "Pass workspacePath or projectPath explicitly.",
    );
  }

  const candidateText = resolutionError.candidates?.length
    ? ` Candidates: ${resolutionError.candidates.join(", ")}`
    : "";

  return err(
    `${resolutionError.message}${candidateText}`,
    "PROJECT_TARGET_REQUIRED",
    resolutionError.hint,
  );
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
