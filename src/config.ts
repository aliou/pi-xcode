import { ConfigLoader } from "@aliou/pi-utils-settings";

export interface XcodeConfig {
  systemPromptGuidance?: boolean;
  guardrailsEnabled?: boolean;
  uiRunnerCommands?: Record<string, string>;
}

export interface ResolvedXcodeConfig {
  systemPromptGuidance: boolean;
  guardrailsEnabled: boolean;
  uiRunnerCommands: Record<string, string>;
}

const DEFAULTS: ResolvedXcodeConfig = {
  systemPromptGuidance: true,
  guardrailsEnabled: false,
  uiRunnerCommands: {},
};

export const configLoader = new ConfigLoader<XcodeConfig, ResolvedXcodeConfig>(
  "xcode",
  DEFAULTS,
  {
    scopes: ["global", "local", "memory"],
  },
);
