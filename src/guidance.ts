export const XCODE_GUIDANCE = `
## Xcode Tools

Use xcode_* tools, not direct bash for xcodebuild/xcrun/xcresulttool.

- xcode_project: discover_projects, list_schemes, show_build_settings, get_bundle_id, doctor
- xcode_build: build, test, clean, resolve_app_path, parse_result_bundle, report
- xcode_simulator: simulator lifecycle/app runtime/env/container actions, plus status/list_apps/app_info/read_defaults/write_defaults
- xcode_ui: UI interaction, waits/asserts, artifacts/logs/crash/report

## Required argument names (strict)

Project/workspace args must be exactly:
- workspacePath
- projectPath

Do not use aliases like:
- workspace
- project
- cwd

## Call order (monorepo-safe)

1) xcode_project { action: "discover_projects" }
2) pick preferred workspacePath/projectPath from discover output
3) xcode_project { action: "list_schemes", workspacePath }
4) xcode_build { action: "build" | "test", scheme, workspacePath }
5) xcode_build { action: "report", resultBundlePath }

## Action requirements

- xcode_build build/test/clean/resolve_app_path: require scheme
- xcode_build report/parse_result_bundle: require resultBundlePath
- xcode_project show_build_settings: require scheme

## Build + install + launch in one call

After editing source (e.g. adding accessibility identifiers), rebuild and redeploy in one call:

xcode_build { action: "build", scheme, workspacePath, install: true, launch: true }

- install: after successful build, installs .app on the simulator (resolves path automatically)
- launch: after successful install, launches the app (resolves bundleId automatically, or pass bundleId)
- Both default to false. Only supported for platform=simulator.
- Prefer this over separate build + simulator install + simulator launch calls when iterating on UI changes.

## UI backend requirements

- xcode_ui interactive actions (tap/type/swipe/scroll/clear_text/describe_ui/query_*/wait_for/assert) require runnerCommand.
- Configure runners per scheme with /xcode:setup, or pass runnerCommand explicitly.
- If runnerCommand is missing, xcode_ui returns MISSING_RUNNER.
- On MISSING_RUNNER: read skills/pi-xcode/references/ui-test-harness.md and ask user whether to scaffold runner.
- Use xcode_simulator for non-runner checks first (status, list_apps, app_info, read_defaults).

UI backend defaults to xcuitest. idb is optional.

## macOS native app automation

For macOS apps (not iOS simulator), use backend=axorcist:

xcode_ui { action: "describe_ui", backend: "axorcist", application: "MyApp" }
xcode_ui { action: "tap", backend: "axorcist", application: "MyApp", params: { title: "Save" } }
xcode_ui { action: "type", backend: "axorcist", application: "MyApp", params: { identifier: "url-field", text: "hello" } }

- Requires axorc CLI (AXorcist) installed.
- Uses macOS Accessibility API. Does not steal focus.
- Pass application as app name or bundle id.
- Element lookup uses params: identifier, title, role, description, placeholder, label.
- Supported actions: describe_ui, tap, type, clear_text, query_text, wait_for, assert, screenshot.
- Do not use osascript or raw bash for macOS UI automation when xcode_ui with axorcist is available.
`;
