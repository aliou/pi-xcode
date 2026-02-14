import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const PLATFORMS = ["ios", "macos"] as const;
type Platform = (typeof PLATFORMS)[number];

export function registerCreateHarness(pi: ExtensionAPI): void {
  pi.registerCommand("xcode:create-harness", {
    description: "Scaffold UI automation harness for an iOS or macOS app",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      let platform: Platform | undefined;

      const raw = parts[0]?.toLowerCase();
      if (raw === "ios" || raw === "macos") {
        platform = raw;
      }

      if (!platform) {
        if (!ctx.hasUI) {
          ctx.ui.notify("Usage: /xcode:create-harness [ios|macos]", "warning");
          return;
        }

        const choice = await ctx.ui.select("Platform", ["iOS", "macOS"]);
        if (!choice) {
          ctx.ui.notify("Cancelled", "warning");
          return;
        }
        platform = choice === "iOS" ? "ios" : "macos";
      }

      const prompt = platform === "ios" ? buildIosPrompt() : buildMacosPrompt();
      pi.sendUserMessage(prompt);
    },
  });
}

function buildIosPrompt(): string {
  return `Set up a UITest automation harness for the iOS app in this project so that \`xcode_ui\` interactive actions (tap, type, describe_ui, etc.) work via \`runnerCommand\`.

Read these reference files from the \`@aliou/pi-xcode\` package for the pattern and contract:
- \`skills/pi-xcode/references/ui-test-harness.md\`
- \`skills/pi-xcode/references/accessibility-for-automation.md\`

Then read these fixture files from the \`@aliou/pi-xcode\` package as working examples:
- \`fixtures/ios-app/UITests/JSONValue.swift\` (protocol types)
- \`fixtures/ios-app/UITests/AutomationBridge.swift\` (action dispatcher)
- \`fixtures/ios-app/UITests/AutomationBridgeHarness.swift\` (XCTest entry point)
- \`fixtures/ios-app/tools/ui-automation-runner.sh\` (runner script)
- \`fixtures/ios-app/project.yml\` (UITest target and scheme with env var passthrough)

Steps:
1. Discover the project structure (workspace/project, schemes, existing test targets).
2. Create a UITest target if one does not exist.
3. Add the three Swift files (JSONValue.swift, AutomationBridge.swift, AutomationBridgeHarness.swift) to the UITest target, adjusting target/scheme names.
4. Create the runner script, adjusting project path, scheme, and simulator destination.
5. Make the runner script executable.
6. Ensure the UITest scheme passes UI_AUTOMATION_PAYLOAD_PATH, UI_AUTOMATION_RESULT_PATH, and UI_AUTOMATION_PAYLOAD_JSON as environment variables.
7. Add \`.accessibilityIdentifier\` to interactive elements in the app views.
8. Build the app and UITest target to verify compilation.
9. Ask which scheme name to associate this runner with (e.g. the UITest scheme name), then configure it via \`/xcode:setup <scheme> <runnerCommand>\`.`;
}

function buildMacosPrompt(): string {
  return `Prepare the macOS app in this project for UI automation using \`xcode_ui\` with \`backend="axorcist"\`.

Read this reference file from the \`@aliou/pi-xcode\` package:
- \`skills/pi-xcode/references/accessibility-for-automation.md\`

Then read this fixture from the \`@aliou/pi-xcode\` package as a working example:
- \`fixtures/macos-app/Sources/ContentView.swift\`

The axorcist backend uses the macOS Accessibility API. No UITest target or runner script is needed.

Steps:
1. Read the app SwiftUI views and identify all interactive elements.
2. Add \`.accessibilityIdentifier(...)\` to each one. Use stable, descriptive, kebab-case identifiers.
3. SwiftUI Buttons on macOS may not expose AXPress. Consider using an NSViewRepresentable wrapper around NSButton for buttons that automation needs to tap reliably.
4. Rebuild and launch the app.
5. Run \`xcode_ui describe_ui\` with \`backend="axorcist"\` and \`application="<AppName>"\` to verify identifiers appear.
6. Test \`tap\` and \`type\` actions against the annotated elements.`;
}
