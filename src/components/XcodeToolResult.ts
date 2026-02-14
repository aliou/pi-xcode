import type {
  Theme,
  ToolRenderResultOptions,
} from "@mariozechner/pi-coding-agent";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { Markdown, Text } from "@mariozechner/pi-tui";

export interface XcodeToolResultConfig {
  /** One-line summary shown when collapsed */
  summary: string;
  /** Whether the operation succeeded */
  succeeded: boolean;
  /** Markdown body shown when expanded */
  detail?: string;
}

/**
 * Collapsed: single line summary (green/red based on success).
 * Expanded: summary + markdown detail.
 */
export class XcodeToolResult implements Component {
  constructor(
    private config: XcodeToolResultConfig,
    private options: ToolRenderResultOptions,
    private theme: Theme,
  ) {}

  handleInput(_data: string): boolean {
    return false;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const lines: string[] = [];
    const th = this.theme;

    const color = this.config.succeeded ? "success" : "error";
    const summary = new Text(th.fg(color, this.config.summary), 0, 0);
    lines.push(...summary.render(width));

    if (this.options.expanded && this.config.detail) {
      lines.push("");
      const md = new Markdown(this.config.detail, 0, 0, getMarkdownTheme());
      lines.push(...md.render(width));
    }

    return lines;
  }
}
