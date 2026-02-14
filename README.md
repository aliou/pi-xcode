# pi-xcode

Xcode development extension for [Pi](https://buildwithpi.ai/).

`@aliou/pi-xcode` gives Pi a stable, tool-first interface for Xcode workflows: project inspection, build/test, simulator runtime control, and UI automation.

## Features

- `xcode_project` - discover projects/workspaces, list schemes, show build settings, read bundle id, run doctor checks
- `xcode_build` - build/test/clean, resolve built app path, parse/report xcresult bundles
- `xcode_simulator` - simulator lifecycle, install/launch/open-url, permissions, locale/appearance/location, container/data ops
- `xcode_ui` - interaction/query/wait/assert + artifacts (screenshots/video/logs/crashes/report export). Supports `xcuitest` (default), `idb`, and `axorcist` (macOS native app automation) backends.
- `/xcode:settings` - configure prompt guidance, guardrails, and runner command
- `/xcode:setup` - configure UI runner command for interactive `xcode_ui` actions

## Architecture

This extension uses 4 tool boundaries by design:

1. `xcode_project`
2. `xcode_build`
3. `xcode_simulator`
4. `xcode_ui`

This split is intentional for LLM reliability and predictable action routing.

## Installation

```bash
# From npm
pi install npm:@aliou/pi-xcode

# From git
pi install git:github.com/aliou/pi-xcode

# Local development
pi -e ./src/index.ts
```

## Settings

Run:

```text
/xcode:settings
```

Settings:
- `systemPromptGuidance` (default: enabled)
- `guardrailsEnabled` (default: disabled)
- `uiRunnerCommand` (default: not configured) - set via `/xcode:setup`

### UI Runner Setup

Interactive `xcode_ui` actions (tap, type, describe_ui, etc.) require a runner command. Configure with:

```text
/xcode:setup
```

Or inline:

```text
/xcode:setup bash tools/ui-automation-runner.sh
```

## Guardrails (optional)

When enabled, guardrails block direct bash usage of:
- `xcodebuild`
- `xcrun simctl`
- `xcrun devicectl`
- `xcrun xcresulttool`
- `xcresulttool`

This forces workflows through `xcode_*` tools.

## UI Automation Setup

`xcode_ui` interactive actions (tap, type, describe_ui, etc.) require setup depending on the platform.

### iOS (simulator)

Requires a UITest target with an automation bridge harness and a runner script. The harness receives action payloads via environment variables, executes them through XCUITest, and returns structured JSON results.

Scaffold one with:

```text
/xcode:create-harness ios
```

Then configure the runner command:

```text
/xcode:setup bash path/to/your/ios/app/tools/ui-automation-runner.sh
```

### macOS (native)

Uses the `axorcist` backend (macOS Accessibility API). No UITest target or runner needed. Interactive elements must have `accessibilityIdentifier` annotations.

Prepare your app with:

```text
/xcode:create-harness macos
```

Then use `backend="axorcist"` and `application="YourAppName"` in `xcode_ui` calls.

## Usage notes

- Simulator-first scope for iOS.
- UI backend defaults to `xcuitest`; `axorcist` for macOS native apps.
- The axorcist `type` action falls back to System Events keystroke simulation when `AXSetValue` is not supported (SwiftUI TextField on macOS).

## Bundled skill

This package ships a `pi-xcode` skill in `skills/pi-xcode/` with reference docs for UI test harness setup and accessibility annotations.

## Development

This project uses a Nix flake for its dev environment. Enter the shell with:

```bash
nix develop
# or: direnv allow
```

Then run:

```bash
pnpm install
pnpm run check
pnpm run check:lockfile
```

Pre-commit is managed by husky and runs:
- lint
- typecheck
- lockfile freshness check

## Fixture Apps

`fixtures/` contains minimal iOS and macOS apps for e2e testing:

- `fixtures/ios-app/` - SwiftUI iOS app with UITest automation harness
- `fixtures/macos-app/` - SwiftUI macOS app for axorcist backend testing

Generate Xcode projects (requires xcodegen from the Nix shell):

```bash
cd fixtures/ios-app && xcodegen generate
cd fixtures/macos-app && xcodegen generate
```

The `.xcodeproj` directories are gitignored.

## Requirements

- Pi coding agent `>=0.52.8`
- macOS with Xcode command-line tooling available (`xcodebuild`, `xcrun`)
- Nix (for dev shell)

## License

MIT
