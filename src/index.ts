import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { registerCreateHarness } from "./commands/create-harness";
import { registerXcodeSettings } from "./commands/settings";
import { registerXcodeSetup } from "./commands/setup";
import { configLoader } from "./config";
import { registerGuardrails } from "./hooks/guardrails";
import { registerGuidance } from "./hooks/system-prompt";
import { registerXcodeBuildTool } from "./tools/xcode-build";
import { registerXcodeProjectTool } from "./tools/xcode-project";
import { registerXcodeSimulatorTool } from "./tools/xcode-simulator";
import { registerXcodeUiTool } from "./tools/xcode-ui";

export default async function (pi: ExtensionAPI) {
  await configLoader.load();

  registerXcodeProjectTool(pi);
  registerXcodeBuildTool(pi);
  registerXcodeSimulatorTool(pi);
  registerXcodeUiTool(pi);

  if (configLoader.getConfig().guardrailsEnabled) {
    registerGuardrails(pi);
  }

  registerGuidance(pi);

  registerXcodeSettings(pi);
  registerXcodeSetup(pi);
  registerCreateHarness(pi);
}
