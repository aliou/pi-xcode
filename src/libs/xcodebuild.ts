/**
 * Typed wrapper around the `xcodebuild` CLI.
 * Absorbs arg-building logic from `utils/xcodebuild.ts`.
 *
 * No Pi tool awareness: no formatResult, no XcodeToolError, no renderers.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { type RunResult, run } from "../utils/exec";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectParams {
  projectPath?: string;
  workspacePath?: string;
}

export interface BuildParams extends ProjectParams {
  scheme: string;
  configuration?: string;
  derivedDataPath?: string;
  extraArgs?: string[];
}

export interface BuildOptions extends BuildParams {
  destination?: string;
  resultBundlePath?: string;
}

export interface TestOptions extends ProjectParams {
  scheme: string;
  destination?: string;
  configuration?: string;
  derivedDataPath?: string;
  resultBundlePath?: string;
  testPlan?: string;
  testType?: "unit" | "ui";
}

export interface CleanOptions extends ProjectParams {
  scheme: string;
}

export interface ListOptions extends ProjectParams {}

export interface ShowBuildSettingsOptions extends ProjectParams {
  scheme: string;
  destination?: string;
  configuration?: string;
}

export interface XcodebuildResult extends RunResult {
  command: string[];
}

// ---------------------------------------------------------------------------
// Arg builders (internal)
// ---------------------------------------------------------------------------

function projectArgs(params: ProjectParams): string[] {
  const args: string[] = [];
  if (params.workspacePath) {
    args.push("-workspace", params.workspacePath);
  } else if (params.projectPath) {
    args.push("-project", params.projectPath);
  }
  return args;
}

function buildArgs(params: BuildParams): string[] {
  const args = projectArgs(params);
  args.push("-scheme", params.scheme);
  if (params.configuration) {
    args.push("-configuration", params.configuration);
  }
  if (params.derivedDataPath) {
    args.push("-derivedDataPath", params.derivedDataPath);
  }
  if (params.extraArgs) {
    args.push(...params.extraArgs);
  }
  return args;
}

// ---------------------------------------------------------------------------
// Public: destination helper (kept public for callers that need it)
// ---------------------------------------------------------------------------

export function destinationArgs(platform: string, id?: string): string[] {
  switch (platform) {
    case "simulator":
      return [
        "-destination",
        id
          ? `platform=iOS Simulator,id=${id}`
          : "generic/platform=iOS Simulator",
      ];
    case "device":
      return [
        "-destination",
        id ? `platform=iOS,id=${id}` : "generic/platform=iOS",
      ];
    case "macos":
      return ["-destination", "platform=macOS"];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function build(
  pi: ExtensionAPI,
  options: BuildOptions,
  signal?: AbortSignal,
): Promise<XcodebuildResult> {
  const command = [
    "xcodebuild",
    "build",
    ...buildArgs(options),
    ...(options.destination ? ["-destination", options.destination] : []),
    ...(options.resultBundlePath
      ? ["-resultBundlePath", options.resultBundlePath]
      : []),
  ];
  const result = await run(pi, command, signal);
  return { ...result, command };
}

export async function test(
  pi: ExtensionAPI,
  options: TestOptions,
  signal?: AbortSignal,
): Promise<XcodebuildResult> {
  const command = [
    "xcodebuild",
    "test",
    ...projectArgs(options),
    "-scheme",
    options.scheme,
    ...(options.destination ? ["-destination", options.destination] : []),
    ...(options.resultBundlePath
      ? ["-resultBundlePath", options.resultBundlePath]
      : []),
    ...(options.configuration ? ["-configuration", options.configuration] : []),
    ...(options.derivedDataPath
      ? ["-derivedDataPath", options.derivedDataPath]
      : []),
    ...(options.testPlan ? ["-testPlan", options.testPlan] : []),
    ...(options.testType === "ui" ? ["-only-testing:*UITests"] : []),
  ];
  const result = await run(pi, command, signal);
  return { ...result, command };
}

export async function clean(
  pi: ExtensionAPI,
  options: CleanOptions,
  signal?: AbortSignal,
): Promise<XcodebuildResult> {
  const command = [
    "xcodebuild",
    "clean",
    ...projectArgs(options),
    "-scheme",
    options.scheme,
  ];
  const result = await run(pi, command, signal);
  return { ...result, command };
}

export async function list(
  pi: ExtensionAPI,
  options: ListOptions,
  signal?: AbortSignal,
): Promise<XcodebuildResult> {
  const command = ["xcodebuild", "-list", "-json", ...projectArgs(options)];
  const result = await run(pi, command, signal);
  return { ...result, command };
}

export async function showBuildSettings(
  pi: ExtensionAPI,
  options: ShowBuildSettingsOptions,
  signal?: AbortSignal,
): Promise<XcodebuildResult> {
  const command = [
    "xcodebuild",
    "-showBuildSettings",
    "-json",
    ...projectArgs(options),
    "-scheme",
    options.scheme,
    ...(options.destination ? ["-destination", options.destination] : []),
    ...(options.configuration ? ["-configuration", options.configuration] : []),
  ];
  const result = await run(pi, command, signal);
  return { ...result, command };
}
