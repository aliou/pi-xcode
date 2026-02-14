import { relative, resolve } from "node:path";

/**
 * Make a path relative to cwd if it's under cwd, else return as-is.
 */
export function relPath(p: string): string {
  const cwd = process.cwd();
  const abs = resolve(p);
  if (abs.startsWith(`${cwd}/`) || abs === cwd) {
    const r = relative(cwd, abs);
    return r || ".";
  }
  return p;
}

/**
 * Format a list of paths as markdown bullet list with relative paths.
 */
export function pathList(paths: string[]): string {
  return paths.map((p) => `- \`${relPath(p)}\``).join("\n");
}

/**
 * Format inline code list: `a`, `b`, `c`
 */
export function inlineCodeList(items: string[]): string {
  return items.map((i) => `\`${i}\``).join(", ");
}

/**
 * Safe JSON parse for details.data which may be a string or object.
 */
export function parseData(data: unknown): Record<string, unknown> | null {
  if (!data) return null;
  if (typeof data === "object" && !Array.isArray(data))
    return data as Record<string, unknown>;
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      if (typeof parsed === "object" && parsed !== null) return parsed;
    } catch {
      // not json
    }
  }
  return null;
}

/**
 * Extract a readable error summary from XcodeToolError[] or raw error text.
 */
export function formatErrors(
  errors: Array<{ message?: string; code?: string; hint?: string }> | undefined,
): string {
  if (!errors || errors.length === 0) return "";
  return errors
    .map((e) => {
      const parts: string[] = [];
      if (e.code) parts.push(`**${e.code}**`);
      if (e.message) parts.push(e.message);
      if (e.hint) parts.push(`_hint: ${e.hint}_`);
      return parts.join(": ");
    })
    .join("\n");
}
