import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { run } from "./exec";

export interface ProjectTargetInput {
  projectPath?: string;
  workspacePath?: string;
}

export interface ResolvedProjectTarget {
  projectPath?: string;
  workspacePath?: string;
  warnings?: string[];
}

export interface ProjectTargetResolutionError {
  message: string;
  hint?: string;
  candidates?: string[];
}

export interface ProjectTargetResolution {
  ok: boolean;
  target?: ResolvedProjectTarget;
  error?: ProjectTargetResolutionError;
}

export async function resolveProjectTarget(
  pi: ExtensionAPI,
  input: ProjectTargetInput,
  signal?: AbortSignal,
): Promise<ProjectTargetResolution> {
  if (input.workspacePath || input.projectPath) {
    const warnings: string[] = [];

    if (input.workspacePath && input.projectPath) {
      warnings.push(
        "Both workspacePath and projectPath provided. workspacePath will be used.",
      );
    }

    return {
      ok: true,
      target: {
        workspacePath: input.workspacePath,
        projectPath: input.workspacePath ? undefined : input.projectPath,
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    };
  }

  const result = await run(
    pi,
    [
      "find",
      ".",
      "-maxdepth",
      "8",
      "(",
      "-name",
      "*.xcworkspace",
      "-o",
      "-name",
      "*.xcodeproj",
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
    return {
      ok: false,
      error: {
        message:
          result.stderr ||
          result.stdout ||
          "Failed to discover workspace/project",
        hint: "Pass workspacePath or projectPath explicitly.",
      },
    };
  }

  const paths = result.stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .sort();

  if (paths.length === 0) {
    return {
      ok: false,
      error: {
        message: "No .xcworkspace or .xcodeproj found under current directory",
        hint: "Use xcode_project discover_projects and pass workspacePath/projectPath.",
      },
    };
  }

  const workspaces = paths.filter((path) => path.endsWith(".xcworkspace"));
  const projects = paths.filter((path) => path.endsWith(".xcodeproj"));
  const preferred = workspaces.length > 0 ? workspaces : projects;

  if (preferred.length !== 1) {
    return {
      ok: false,
      error: {
        message: `Multiple Xcode targets found (${preferred.length}).`,
        hint: "Pass workspacePath or projectPath explicitly.",
        candidates: preferred.slice(0, 20),
      },
    };
  }

  const selectedPath = preferred[0];
  const isWorkspace = selectedPath.endsWith(".xcworkspace");

  return {
    ok: true,
    target: {
      workspacePath: isWorkspace ? selectedPath : undefined,
      projectPath: isWorkspace ? undefined : selectedPath,
      warnings: [
        `Auto-selected ${isWorkspace ? "workspacePath" : "projectPath"}: ${selectedPath}`,
      ],
    },
  };
}
