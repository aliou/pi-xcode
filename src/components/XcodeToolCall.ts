import type { Theme } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { Text, TruncatedText } from "@mariozechner/pi-tui";

export interface XcodeToolCallConfig {
  /** Tool label, e.g. "Discover Projects", "Build for Simulator" */
  label: string;
  /** Key-value fields to show below the title */
  fields: { label: string; value: string }[];
}

/**
 * Renders:
 *   Xcode: Label (bold, toolTitle color)
 *     Key: value
 *     Key: value
 */
export class XcodeToolCall implements Component {
  constructor(
    private config: XcodeToolCallConfig,
    private theme: Theme,
  ) {}

  handleInput(_data: string): boolean {
    return false;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const lines: string[] = [];
    const th = this.theme;

    const title = new TruncatedText(
      `${th.fg("toolTitle", th.bold("Xcode:"))} ${th.fg("toolTitle", this.config.label)}`,
    );
    lines.push(...title.render(width));

    for (const field of this.config.fields) {
      const text = new Text(
        `${th.fg("muted", `${field.label}: `)}${field.value}`,
        0,
        0,
      );
      lines.push(...text.render(width));
    }

    return lines;
  }
}
