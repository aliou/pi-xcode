import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import { truncateHead } from "@mariozechner/pi-coding-agent";

export interface XcodeToolError {
  message: string;
  code?: string;
  hint?: string;
}

export interface XcodeToolDetails {
  ok: boolean;
  action: string;
  data?: unknown;
  artifacts?: Record<string, string>;
  warnings?: string[];
  errors?: XcodeToolError[];
  backend?: "xcuitest" | "idb" | "axorcist";
}

export function err(
  message: string,
  code?: string,
  hint?: string,
): XcodeToolError {
  return { message, code, hint };
}

export function summarizeErrors(errors: XcodeToolError[] | undefined): string {
  if (!errors || errors.length === 0) return "";
  return errors
    .map((e) => {
      const parts = [e.message];
      if (e.code) parts[0] = `[${e.code}] ${parts[0]}`;
      if (e.hint) parts.push(`  hint: ${e.hint}`);
      return parts.join("\n");
    })
    .join("\n");
}

/**
 * Build a tool result. `content` is what the LLM sees. `details` is UI-only.
 *
 * Content includes:
 * - summary line
 * - serialized data (JSON, truncated)
 * - errors with codes and hints
 * - warnings
 * - artifact paths
 */
export function formatResult(
  action: string,
  summary: string,
  details: XcodeToolDetails,
) {
  const parts: string[] = [summary];

  if (details.data !== undefined) {
    const json = serializeData(details.data);
    if (json) parts.push(json);
  }

  if (details.artifacts && Object.keys(details.artifacts).length > 0) {
    const lines = Object.entries(details.artifacts).map(
      ([k, v]) => `  ${k}: ${v}`,
    );
    parts.push(`Artifacts:\n${lines.join("\n")}`);
  }

  if (details.errors && details.errors.length > 0) {
    parts.push(summarizeErrors(details.errors));
  }

  if (details.warnings && details.warnings.length > 0) {
    parts.push(
      `Warnings:\n${details.warnings.map((w) => `  - ${w}`).join("\n")}`,
    );
  }

  const raw = parts.join("\n\n");
  const truncated = truncateHead(raw, { maxBytes: 30_000, maxLines: 500 });

  return {
    content: [{ type: "text" as const, text: truncated.content }] as (
      | TextContent
      | ImageContent
    )[],
    details: {
      ...details,
      action,
    },
  };
}

const DATA_EXCLUDE_KEYS = new Set(["stdout", "stderr", "command", "raw"]);

function serializeData(data: unknown): string | null {
  if (data === null || data === undefined) return null;

  if (typeof data === "string") {
    return data.length > 0 ? data : null;
  }

  if (typeof data !== "object") {
    return String(data);
  }

  const filtered = filterLargeFields(data as Record<string, unknown>);
  try {
    const json = JSON.stringify(filtered, null, 2);
    if (json === "{}" || json === "[]") return null;
    return json;
  } catch {
    return null;
  }
}

function filterLargeFields(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (DATA_EXCLUDE_KEYS.has(key)) {
      if (typeof value === "string" && value.length > 500) {
        out[key] = `[${value.length} chars, see details]`;
      } else {
        out[key] = value;
      }
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Validate that action is one of the valid values.
 * Returns an error with the list of valid actions, or undefined if valid.
 */
export function validateAction(
  _toolName: string,
  action: unknown,
  validActions: readonly string[],
): XcodeToolError | undefined {
  if (typeof action !== "string" || !action) {
    return err(
      `Missing required argument 'action'. Valid actions: ${validActions.join(", ")}`,
      "VALIDATION_FAILED",
    );
  }
  if (!validActions.includes(action)) {
    return err(
      `Unknown action '${action}'. Valid actions: ${validActions.join(", ")}`,
      "VALIDATION_FAILED",
    );
  }
  return undefined;
}
