import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { configLoader } from "../config";
import { XCODE_GUIDANCE } from "../guidance";

export function registerGuidance(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (event) => {
    if (!configLoader.getConfig().systemPromptGuidance) return;

    return {
      systemPrompt: `${event.systemPrompt}\n${XCODE_GUIDANCE}`,
    };
  });
}
