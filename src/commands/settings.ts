import {
  displayToStorageValue,
  registerSettingsCommand,
  type SettingsSection,
  setNestedValue,
} from "@aliou/pi-utils-settings";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  configLoader,
  type ResolvedXcodeConfig,
  type XcodeConfig,
} from "../config";

function formatRunnerDescription(commands: Record<string, string>): string {
  const entries = Object.entries(commands);
  if (entries.length === 0)
    return "No runners configured. Use /xcode:setup to add one.";
  return entries.map(([scheme, cmd]) => `${scheme}: ${cmd}`).join(", ");
}

export function registerXcodeSettings(pi: ExtensionAPI): void {
  registerSettingsCommand<XcodeConfig, ResolvedXcodeConfig>(pi, {
    commandName: "xcode:settings",
    commandDescription: "Configure xcode extension settings",
    title: "Xcode Settings",
    configStore: configLoader,
    buildSections: (
      tabConfig: XcodeConfig | null,
      resolved: ResolvedXcodeConfig,
    ): SettingsSection[] => {
      return [
        {
          label: "System Prompt",
          items: [
            {
              id: "systemPromptGuidance",
              label: "Append xcode guidance",
              description: "Inject xcode tool usage guidance in system prompt",
              currentValue:
                (tabConfig?.systemPromptGuidance ??
                resolved.systemPromptGuidance)
                  ? "enabled"
                  : "disabled",
              values: ["enabled", "disabled"],
            },
          ],
        },
        {
          label: "Guardrails",
          items: [
            {
              id: "guardrailsEnabled",
              label: "Enable bash guardrails",
              description:
                "Block direct bash xcodebuild/xcrun/xcresulttool usage. Disabled by default.",
              currentValue:
                (tabConfig?.guardrailsEnabled ?? resolved.guardrailsEnabled)
                  ? "enabled"
                  : "disabled",
              values: ["enabled", "disabled"],
            },
          ],
        },
        {
          label: "UI Runner",
          items: [
            {
              id: "uiRunnerCommands",
              label: "Runner commands",
              description: formatRunnerDescription(
                tabConfig?.uiRunnerCommands ?? resolved.uiRunnerCommands,
              ),
              currentValue: `${Object.keys(tabConfig?.uiRunnerCommands ?? resolved.uiRunnerCommands).length} configured`,
              values: [],
            },
          ],
        },
      ];
    },
    onSettingChange: (id, newValue, config) => {
      if (id === "uiRunnerCommands") return null;
      const updated = structuredClone(config);
      setNestedValue(updated, id, displayToStorageValue(newValue));
      return updated;
    },
  });
}
