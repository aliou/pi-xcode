# UI Test Harness for Automation Runners

This guide explains how to create and maintain a UI test harness that can be driven by external automation (including `xcode_ui` via `runnerCommand`).

## Goal

Provide one stable command that:

1. receives an action payload
2. executes a UI action through XCTest/XCUITest
3. returns structured JSON result

Keep integration-specific logic isolated in harness files only.

## Architecture

Use three parts:

1. **Harness test entrypoint** (inside existing UITest target)
2. **Action dispatcher** (maps payload action -> XCTest interaction)
3. **Runner script** (wraps `xcodebuild test`, manages payload/result files)

This keeps app code and normal UI tests untouched.

## Minimal I/O contract

Use env vars so the runner can control execution without repo-wide changes.

### Input

- `UI_AUTOMATION_PAYLOAD_PATH` (preferred): path to JSON payload file
- fallback `UI_AUTOMATION_PAYLOAD_JSON`: raw JSON payload string

Payload shape:

```json
{
  "action": "describe_ui",
  "params": {},
  "metadata": {}
}
```

### Output

- `UI_AUTOMATION_RESULT_PATH`: path to JSON result file
- Also print same JSON to stdout

Result shape:

```json
{
  "ok": true,
  "action": "describe_ui",
  "data": {},
  "warnings": [],
  "errors": []
}
```

Error shape:

```json
{
  "ok": false,
  "action": "tap",
  "errors": [
    {
      "message": "Element not hittable",
      "code": "NOT_HITTABLE",
      "hint": "Use accessibilityIdentifier and wait_for first"
    }
  ]
}
```

## Harness implementation pattern

Add one test class and keep it isolated, for example:

- `AutomationBridgeHarness.swift`

Recommended responsibilities:

- parse payload safely
- switch on `action`
- execute action handlers
- serialize structured result
- never crash on malformed payload (return structured error)

### Suggested baseline actions

- `describe_ui`: return visible elements summary (labels/buttons/fields + ids)
- `tap`: prefer accessibility id; optional coordinate fallback if explicitly requested
- `type`: type into focused element or by identifier
- `query_text`: find text exact/contains
- `wait_for`: wait for element existence/hittable with timeout
- `assert`: boolean assertions with clear errors

### Determinism rules

- prefer explicit waits to fixed sleeps
- return timeout errors with target criteria
- keep handlers idempotent when possible
- include enough `data` to debug failures

## Runner script pattern

Create `tools/ui-automation-runner.sh`.

Responsibilities:

1. accept payload JSON as argv[1]
2. write payload to temp file
3. create temp result file path
4. run harness test via `xcodebuild test`
5. print only result JSON
6. exit non-zero on failure

Example skeleton:

```bash
#!/usr/bin/env bash
set -euo pipefail

PAYLOAD_JSON="${1:-}"
if [ -z "$PAYLOAD_JSON" ]; then
  echo '{"ok":false,"action":"unknown","errors":[{"message":"missing payload"}]}'
  exit 1
fi

TMP_DIR="$(mktemp -d)"
PAYLOAD_PATH="$TMP_DIR/payload.json"
RESULT_PATH="$TMP_DIR/result.json"
LOG_PATH="$TMP_DIR/xcodebuild.log"

printf '%s' "$PAYLOAD_JSON" > "$PAYLOAD_PATH"

UI_AUTOMATION_PAYLOAD_PATH="$PAYLOAD_PATH" \
UI_AUTOMATION_RESULT_PATH="$RESULT_PATH" \
xcodebuild test \
  -workspace "<workspacePath>" \
  -scheme "<uiTestScheme>" \
  -destination "platform=iOS Simulator,id=<deviceId>" \
  -only-testing:"<UITestTarget>/<HarnessClass>/testRunHarnessAction" \
  >"$LOG_PATH" 2>&1 || {
    if [ -f "$RESULT_PATH" ]; then
      cat "$RESULT_PATH"
    else
      echo "{\"ok\":false,\"action\":\"unknown\",\"errors\":[{\"message\":\"xcodebuild test failed\",\"code\":\"XCODEBUILD_FAILED\",\"hint\":\"see $LOG_PATH\"}]}"
    fi
    exit 1
  }

if [ ! -f "$RESULT_PATH" ]; then
  echo "{\"ok\":false,\"action\":\"unknown\",\"errors\":[{\"message\":\"result file missing\",\"code\":\"MISSING_RESULT\",\"hint\":\"harness must write UI_AUTOMATION_RESULT_PATH\"}]}"
  exit 1
fi

cat "$RESULT_PATH"
```

## Using with pi-xcode `xcode_ui`

`xcode_ui` interactive actions require `runnerCommand`.

Example tool call:

```json
{
  "action": "describe_ui",
  "deviceId": "<simulator-udid>",
  "runnerCommand": "bash tools/ui-automation-runner.sh"
}
```

The extension passes a payload argument to `runnerCommand`.
Your script must accept that argument and emit structured JSON.

## Accessibility identifiers

The harness finds elements by `accessibilityIdentifier`. SwiftUI views without one are invisible to `tap`, `type`, `clear_text`, `wait_for`, and `assert`.

Before running UI automation on a view, make sure every interactive element has an identifier:

```swift
TextField("Relay URL", text: $urlText)
    .accessibilityIdentifier("relay-url-field")

Button("Save") { save() }
    .accessibilityIdentifier("save-button")
```

Rules:

- Add `.accessibilityIdentifier(...)` to every button, text field, toggle, and link the harness needs to reach.
- Use stable, descriptive kebab-case ids (`"settings-tab"`, `"chat-input"`). Do not use display text or SF Symbol names as identifiers.
- SF Symbol names (e.g. `"gear"`, `"bubble.left.and.bubble.right"`) sometimes work as identifiers because SwiftUI/UIKit exposes them, but they are fragile. Prefer explicit ids.
- Tab bar items and navigation links need identifiers too. In SwiftUI use `.accessibilityIdentifier(...)` on the `Label` or the view inside `.tabItem {}`.
- Run `describe_ui` to verify the identifier appears in the elements list before writing tap/type calls against it.
- If `describe_ui` shows `"identifier": ""` for an element, it needs an explicit identifier added in source.

When adding identifiers as part of a UI automation task:

1. Read the source for the view you need to interact with.
2. Add `.accessibilityIdentifier(...)` to each target element.
3. Rebuild the app target (not the UITest target).
4. Reinstall and relaunch on simulator.
5. Run `describe_ui` to confirm identifiers are visible.
6. Proceed with `tap`/`type`/`assert` calls using those identifiers.

## Update strategy

When app UI changes:

1. update selectors (prefer accessibility identifiers)
2. keep action names and payload keys stable
3. add backward-compatible behavior before breaking changes
4. include `warnings` when behavior is degraded but still usable

When adding actions:

1. implement handler
2. document payload params
3. return stable error codes
4. add at least one harness self-test for the new action path

## Troubleshooting

### `MISSING_RUNNER` from `xcode_ui`

- ensure `runnerCommand` is passed
- ensure script is executable
- ensure script accepts payload arg and prints JSON

### Harness runs but no result file

- verify `UI_AUTOMATION_RESULT_PATH` is read by harness
- ensure harness writes file on success and on failures

### Flaky taps/types

- use accessibility identifiers
- add `wait_for` before interaction
- avoid coordinate taps unless no semantic selector exists

### Wrong simulator/device

- pass explicit simulator UDID in destination and tool call
- verify with `xcode_simulator` `status` and `list_apps`

## Recommended boundaries

- Keep bridge logic in harness files only.
- Keep app code unaware of automation runner details.
- Keep tool-specific concerns in script/config, not in app features.
