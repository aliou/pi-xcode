#!/usr/bin/env bash
set -euo pipefail

PAYLOAD_JSON="${1:-}"
if [ -z "$PAYLOAD_JSON" ]; then
  echo '{"ok":false,"action":"unknown","errors":[{"message":"missing payload"}]}'
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

TMP_DIR="$(mktemp -d)"
PAYLOAD_PATH="$TMP_DIR/payload.json"
RESULT_PATH="$TMP_DIR/result.json"
LOG_PATH="$TMP_DIR/xcodebuild.log"

printf '%s' "$PAYLOAD_JSON" > "$PAYLOAD_PATH"

# Generate project if needed.
if [ ! -d "$PROJECT_DIR/PiXcodeTestApp.xcodeproj" ]; then
  (cd "$PROJECT_DIR" && xcodegen generate --quiet)
fi

UI_AUTOMATION_PAYLOAD_PATH="$PAYLOAD_PATH" \
UI_AUTOMATION_RESULT_PATH="$RESULT_PATH" \
xcodebuild test \
  -project "$PROJECT_DIR/PiXcodeTestApp.xcodeproj" \
  -scheme "PiXcodeTestApp UITests" \
  -destination "platform=iOS Simulator,name=iPhone 17 Pro" \
  -only-testing:"PiXcodeTestApp UITests/AutomationBridgeHarness/testRunAction" \
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
