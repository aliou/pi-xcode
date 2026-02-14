import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { configLoader, type XcodeConfig } from "../config";

const DEFAULT_RUNNER_COMMAND = "bash tools/ui-automation-runner.sh";
const DEFAULT_SCHEME = "default";

export function registerXcodeSetup(pi: ExtensionAPI): void {
  pi.registerCommand("xcode:setup", {
    description: "Configure xcode UI runner command",
    handler: async (args, ctx) => {
      const inline = args.trim();
      if (inline) {
        // Parse first word as scheme, rest as command
        const parts = inline.split(/\s+/);
        const scheme = parts[0];
        const command = parts.slice(1).join(" ");
        if (!command) {
          ctx.ui.notify(
            "Usage: /xcode:setup <scheme> <runnerCommand>",
            "warning",
          );
          return;
        }
        await saveRunnerCommand(scheme, command);
        if (ctx.hasUI) {
          ctx.ui.notify("xcode UI runner configured", "info");
        }
        return;
      }

      if (!ctx.hasUI) {
        return;
      }

      const shouldConfigure = await ctx.ui.confirm(
        "Configure UI runner",
        "Interactive xcode_ui actions require a runner command. Configure now?",
      );
      if (!shouldConfigure) {
        ctx.ui.notify("Setup cancelled", "warning");
        return;
      }

      const scheme = await ctx.ui.input(
        "Scheme name (e.g. UITest scheme name)",
        DEFAULT_SCHEME,
      );
      if (!scheme) {
        ctx.ui.notify("No scheme name provided", "warning");
        return;
      }

      const runner = await ctx.ui.input(
        "UI runner command",
        DEFAULT_RUNNER_COMMAND,
      );

      if (!runner) {
        ctx.ui.notify("No runner command provided", "warning");
        return;
      }

      const scopeChoice = await ctx.ui.select("Save scope", [
        "global",
        "local",
      ]);
      if (!scopeChoice) {
        ctx.ui.notify("Setup cancelled", "warning");
        return;
      }

      await saveRunnerCommand(
        scheme.trim(),
        runner.trim(),
        scopeChoice as "global" | "local",
      );
      ctx.ui.notify("xcode UI runner configured", "info");
    },
  });
}

async function saveRunnerCommand(
  scheme: string,
  runnerCommand: string,
  scope: "global" | "local" = "global",
): Promise<void> {
  const current = (configLoader.getRawConfig(scope) ?? {}) as XcodeConfig;
  const commands = { ...current.uiRunnerCommands };
  commands[scheme] = runnerCommand;
  await configLoader.save(scope, {
    ...current,
    uiRunnerCommands: commands,
  });
}
