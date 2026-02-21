---
name: pi-xcode
description: Use when working with the @aliou/pi-xcode extension, including xcode_project/xcode_build/xcode_simulator/xcode_ui workflows, monorepo workspace/project path selection, simulator app lifecycle, and UI automation setup with a runner-backed test harness.
---

# pi-xcode

Use this skill when the task uses Pi's Xcode toolchain through `@aliou/pi-xcode`.

## Tools and boundaries

- `xcode_project`: discover/list schemes/build settings/bundle id/doctor
- `xcode_build`: build/test/clean/resolve app path/xcresult parse+report
- `xcode_simulator`: simulator lifecycle + app runtime + container/defaults/app info
- `xcode_ui`: UI automation and UI artifacts (backends: xcuitest, idb, axorcist)

Do not use direct `xcodebuild`, `xcrun simctl`, or `xcresulttool` when equivalent `xcode_*` actions exist.

## Parameter discipline

Use exact argument names:

- `workspacePath`
- `projectPath`

Do not use aliases like `workspace`, `project`, or `cwd`.

## Recommended flow

1. `xcode_project` `discover_projects`
2. pick `workspacePath` (preferred) or `projectPath`
3. `xcode_project` `list_schemes`
4. `xcode_build` `build`/`test` with `scheme` + chosen path
5. `xcode_build` `report` with `resultBundlePath`

## Required fields to remember

- `xcode_build` `build`/`test`/`clean`/`resolve_app_path`: require `scheme`
- `xcode_build` `report`/`parse_result_bundle`: require `resultBundlePath`
- `xcode_project` `show_build_settings`: require `scheme`

## Build + install + launch in one call

After editing source (e.g. adding accessibility identifiers), rebuild and redeploy:

```json
{
  "action": "build",
  "scheme": "MyApp",
  "workspacePath": "MyApp.xcworkspace",
  "install": true,
  "launch": true
}
```

- `install`: installs `.app` on simulator after successful build (resolves path automatically)
- `launch`: launches the app after install (resolves `bundleId` automatically, or pass it explicitly)
- Both default to `false`. Only supported for `platform=simulator`.
- Prefer this over separate build + install + launch calls when iterating.

## Simulator-first debugging checks

After install/launch issues, use these first:

- `xcode_simulator` `status`
- `xcode_simulator` `list_apps`
- `xcode_simulator` `app_info`
- `xcode_simulator` `read_defaults`

## UI automation requirement

Interactive `xcode_ui` actions (`tap`, `type`, `swipe`, `scroll`, `clear_text`, `describe_ui`, `query_text`, `query_controls`, `wait_for`, `assert`) require `runnerCommand` when using `xcuitest` or `idb` backends.

Long-press gesture support is typically implemented via `tap` with a `duration` param in the runner bridge.
Use this pattern unless the tool schema explicitly exposes a dedicated `long_press` action.

Example:

```json
{
  "action": "tap",
  "deviceId": "SIMULATOR_ID",
  "params": {
    "identifier": "browse-list-item-twitter:2023805578561060992",
    "duration": 1.0
  }
}
```

If the element is not hittable, first call `describe_ui` and verify the identifier exists and `isHittable: true`.

If missing, tool returns `MISSING_RUNNER`. Configure with `/xcode:setup` or pass `runnerCommand` explicitly.

For macOS native app automation, use `backend="axorcist"` instead. This uses the macOS Accessibility API and does not require a runner command.

The axorcist `type` action falls back to System Events keystroke simulation when `AXSetValue` is not supported (common with SwiftUI TextField on macOS). The element is tapped to focus it first, then keystrokes are sent via osascript.

Before tapping or typing into an element, it must have an `accessibilityIdentifier` in source. If `describe_ui` shows `"identifier": ""`, add `.accessibilityIdentifier(...)` in the SwiftUI view, rebuild, reinstall, and relaunch before retrying.

For setup, maintenance, and accessibility identifier guidance, read:

- `references/ui-test-harness.md` — runner/harness setup for iOS simulator automation
- `references/accessibility-for-automation.md` — making apps automatable (iOS and macOS)

## Fixture apps for testing

The repository includes e2e fixture apps in `fixtures/`:

- `fixtures/ios-app/` - iOS app with UITest automation bridge (XcodeGen, scheme `PiXcodeTestApp` + `PiXcodeTestApp UITests`)
- `fixtures/macos-app/` - macOS app for axorcist testing (XcodeGen, scheme `PiXcodeTestMacApp`)

Generate projects with `xcodegen generate` inside each directory. Both apps have accessibility identifiers on all interactive elements.
