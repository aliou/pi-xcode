/**
 * Typed wrapper around the `axorc` CLI (AXorcist).
 * Low-level protocol only: sends JSON commands via stdin, parses responses.
 * High-level action orchestration stays in `backends/axorcist.ts`.
 *
 * No Pi tool awareness: no formatResult, no XcodeToolError, no renderers.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AxorcResponse } from "../utils/backends/axorcist-types";
import { hasCommand } from "../utils/backends/helpers";
import { run } from "../utils/exec";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CollectAllOptions {
  application: string;
  attributes?: string[];
  maxDepth?: number;
}

export interface PerformActionOptions {
  application: string;
  locator: unknown;
  actionName: string;
  actionValue?: unknown;
  maxDepth?: number;
}

export interface ExtractTextOptions {
  application: string;
  locator?: unknown;
  includeChildren?: boolean;
  maxDepth?: number;
}

export interface QueryOptions {
  application: string;
  locator: unknown;
  attributes?: string[];
  maxDepth?: number;
}

export interface SetFocusedValueOptions {
  application: string;
  value: string;
}

export interface AxorcResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  raw?: AxorcResponse;
}

// ---------------------------------------------------------------------------
// Core execution
// ---------------------------------------------------------------------------

async function runAxorcRaw(
  pi: ExtensionAPI,
  cmd: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<AxorcResult> {
  const payload = JSON.stringify(cmd);
  const result = await run(
    pi,
    [
      "bash",
      "-lc",
      `echo '${payload.replaceAll("'", "'\\''")}' | axorc --stdin --scan-all`,
    ],
    signal,
  );

  const stdout = result.stdout.trim();

  let parsed: AxorcResponse;
  try {
    parsed = JSON.parse(stdout) as AxorcResponse;
  } catch {
    return {
      ok: false,
      error: result.stderr.trim() || stdout || "axorc returned no valid JSON",
      data: { exitCode: result.exitCode, stdout, stderr: result.stderr.trim() },
    };
  }

  if (parsed.status === "error") {
    const message =
      typeof parsed.error === "string"
        ? parsed.error
        : typeof parsed.error === "object" && parsed.error?.message
          ? parsed.error.message
          : "axorc command failed";
    return {
      ok: false,
      error: message,
      raw: parsed,
      data: parsed,
    };
  }

  return {
    ok: true,
    data: parsed.data ?? parsed,
    raw: parsed,
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function collectAll(
  pi: ExtensionAPI,
  options: CollectAllOptions,
  signal?: AbortSignal,
): Promise<AxorcResult> {
  return runAxorcRaw(
    pi,
    {
      command_id: "collect_all",
      command: "collectAll",
      application: options.application,
      attributes: options.attributes ?? [
        "AXRole",
        "AXTitle",
        "AXIdentifier",
        "AXValue",
        "AXEnabled",
        "AXDescription",
        "AXPlaceholderValue",
      ],
      max_depth: options.maxDepth ?? 5,
    },
    signal,
  );
}

export async function performAction(
  pi: ExtensionAPI,
  options: PerformActionOptions,
  signal?: AbortSignal,
): Promise<AxorcResult> {
  return runAxorcRaw(
    pi,
    {
      command_id: "perform_action",
      command: "performAction",
      application: options.application,
      locator: options.locator,
      action_name: options.actionName,
      ...(options.actionValue !== undefined
        ? { action_value: options.actionValue }
        : {}),
      max_depth: options.maxDepth ?? 15,
    },
    signal,
  );
}

export async function extractText(
  pi: ExtensionAPI,
  options: ExtractTextOptions,
  signal?: AbortSignal,
): Promise<AxorcResult> {
  return runAxorcRaw(
    pi,
    {
      command_id: "extract_text",
      command: "extractText",
      application: options.application,
      ...(options.locator ? { locator: options.locator } : {}),
      include_children: options.includeChildren ?? true,
      max_depth: options.maxDepth ?? 10,
    },
    signal,
  );
}

export async function query(
  pi: ExtensionAPI,
  options: QueryOptions,
  signal?: AbortSignal,
): Promise<AxorcResult> {
  return runAxorcRaw(
    pi,
    {
      command_id: "query",
      command: "query",
      application: options.application,
      locator: options.locator,
      attributes: options.attributes ?? [
        "AXRole",
        "AXTitle",
        "AXIdentifier",
        "AXEnabled",
      ],
      max_depth: options.maxDepth ?? 10,
    },
    signal,
  );
}

export async function setFocusedValue(
  pi: ExtensionAPI,
  options: SetFocusedValueOptions,
  signal?: AbortSignal,
): Promise<AxorcResult> {
  return runAxorcRaw(
    pi,
    {
      command_id: "set_focused_value",
      command: "setFocusedValue",
      application: options.application,
      action_value: { value: options.value },
    },
    signal,
  );
}

export async function hasAxorc(
  pi: ExtensionAPI,
  signal?: AbortSignal,
): Promise<boolean> {
  return hasCommand(pi, "axorc", signal);
}
