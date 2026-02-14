import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const BLOCK_RULES: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /(^|\s)xcodebuild(\s|$)/,
    reason: "use xcode_build or xcode_project",
  },
  {
    pattern: /xcrun\s+simctl/,
    reason: "use xcode_simulator or xcode_ui",
  },
  {
    pattern: /xcrun\s+devicectl/,
    reason: "device workflows disabled. simulator-first via xcode_simulator",
  },
  {
    pattern: /xcrun\s+xcresulttool/,
    reason: "use xcode_build parse_result_bundle/report",
  },
  {
    pattern: /(^|\s)xcresulttool(\s|$)/,
    reason: "use xcode_build parse_result_bundle/report",
  },
];

export function registerGuardrails(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event) => {
    if (event.toolName !== "bash") return undefined;

    const command = String(
      (event.input as { command?: string })?.command ?? "",
    );

    for (const rule of BLOCK_RULES) {
      if (rule.pattern.test(command)) {
        return {
          block: true,
          reason: `Blocked by xcode guardrails: ${rule.reason}. use xcode_* tools only.`,
        };
      }
    }

    return undefined;
  });
}
