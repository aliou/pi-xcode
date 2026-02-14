/**
 * AXorcist backend for macOS native app UI automation.
 * High-level action orchestration: describe_ui, tap (with fallback),
 * waitFor polling, element normalization, locator building.
 * Delegates raw axorc calls to `libs/axorcist.ts`.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as axorc from "../../libs/axorcist";
import * as osascript from "../../libs/osascript";
import * as screencaptureLib from "../../libs/screencapture";
import * as swiftRunner from "../../libs/swift-runner";
import { err } from "../errors";
import type {
  AxorcCollectAllData,
  AxorcElementData,
  AxorcExtractTextData,
} from "./axorcist-types";
import { unwrapBool, unwrapString } from "./axorcist-types";
import { makeDefaultArtifactPath } from "./helpers";
import type { UiActionContext, UiActionResult } from "./types";

const BACKEND: "axorcist" = "axorcist";

const AXORCIST_ACTIONS = new Set([
  "describe_ui",
  "tap",
  "type",
  "clear_text",
  "query_text",
  "wait_for",
  "assert",
  "screenshot",
]);

export function axorcistSupportsAction(action: string): boolean {
  return AXORCIST_ACTIONS.has(action);
}

export async function executeAxorcistAction(
  pi: ExtensionAPI,
  ctx: UiActionContext,
  signal?: AbortSignal,
): Promise<UiActionResult> {
  const axorcAvailable = await axorc.hasAxorc(pi, signal);
  if (!axorcAvailable) {
    return {
      ok: false,
      backend: BACKEND,
      errors: [
        err(
          "axorc command not found",
          "AXORC_NOT_FOUND",
          "install AXorcist: git clone https://github.com/steipete/AXorcist && cd AXorcist && swift build -c release && cp .build/release/axorc /usr/local/bin/",
        ),
      ],
    };
  }

  const rawApplication = ctx.application;
  if (!rawApplication) {
    return {
      ok: false,
      backend: BACKEND,
      errors: [
        err(
          "axorcist backend requires 'application' (app name or bundle id)",
          "MISSING_APPLICATION",
          "pass application param, e.g. application='com.example.MyApp' or application='MyApp'",
        ),
      ],
    };
  }

  // Resolve display name -> bundle ID if needed. axorc only reliably finds
  // apps by bundle ID; display names like "Pi" fail for non-system apps.
  const application = await resolveApplicationId(pi, rawApplication, signal);

  const p = ctx.params ?? {};

  switch (ctx.action) {
    case "describe_ui":
      return describeUi(pi, application, p, signal);
    case "tap":
      return tap(pi, application, p, signal);
    case "type":
      return typeAction(pi, application, p, signal);
    case "clear_text":
      return clearText(pi, application, p, signal);
    case "query_text":
      return queryText(pi, application, p, signal);
    case "wait_for":
      return waitFor(pi, application, p, signal);
    case "assert":
      return assertElement(pi, application, p, signal);
    case "screenshot":
      return screenshot(pi, p, signal);
    default:
      return {
        ok: false,
        backend: BACKEND,
        errors: [
          err(
            `action '${ctx.action}' is not supported on axorcist backend`,
            "UNSUPPORTED_ACTION",
          ),
        ],
      };
  }
}

// ---------------------------------------------------------------------------
// Action implementations
// ---------------------------------------------------------------------------

async function describeUi(
  pi: ExtensionAPI,
  application: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<UiActionResult> {
  const maxDepth = typeof params.maxDepth === "number" ? params.maxDepth : 5;

  const result = await axorc.collectAll(pi, { application, maxDepth }, signal);
  if (!result.ok) {
    return {
      ok: false,
      backend: BACKEND,
      errors: [err(result.error ?? "collectAll failed", "AXORC_ERROR")],
      data: result.data,
    };
  }

  const data = result.data as AxorcCollectAllData | undefined;
  const elements = data?.elements?.map(normalizeElement) ?? [];

  return {
    ok: true,
    backend: BACKEND,
    data: { count: elements.length, elements },
  };
}

async function tap(
  pi: ExtensionAPI,
  application: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<UiActionResult> {
  const locator = buildLocator(params);
  if (!locator) {
    return {
      ok: false,
      backend: BACKEND,
      errors: [
        err(
          "tap requires at least one of: identifier, title, role",
          "MISSING_PARAMS",
        ),
      ],
    };
  }

  const result = await axorc.performAction(
    pi,
    {
      application,
      locator,
      actionName: "AXPress",
      maxDepth: 15,
    },
    signal,
  );

  if (result.ok) {
    return { ok: true, backend: BACKEND, data: result.data };
  }

  // Fallback: SwiftUI Buttons on macOS don't populate the AXActions attribute
  // list, so axorc's validation rejects AXPress. However, the underlying
  // AXUIElementPerformAction *does* work. Use a direct Swift helper.
  return tapViaAccessibilityApi(pi, application, params, signal);
}

/**
 * Fallback tap using AXUIElementPerformAction directly via a Swift script.
 *
 * SwiftUI on macOS does not populate AXActions on Button elements, causing
 * axorc to reject AXPress. But `AXUIElementPerformAction(el, "AXPress")`
 * succeeds when called directly. This helper compiles and runs a small Swift
 * snippet that walks the AX tree by identifier and calls AXPress.
 *
 * If AXPress still fails, it falls back to CGEvent coordinate click.
 */
async function tapViaAccessibilityApi(
  pi: ExtensionAPI,
  application: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<UiActionResult> {
  const identifier = params.identifier as string | undefined;
  const title = params.title as string | undefined;

  // We need at least an identifier or title to locate the element.
  const searchAttr = identifier ? "AXIdentifier" : title ? "AXTitle" : null;
  const searchValue = identifier ?? title;

  if (!searchAttr || !searchValue) {
    return {
      ok: false,
      backend: BACKEND,
      errors: [
        err("AXPress fallback requires identifier or title", "MISSING_PARAMS"),
      ],
    };
  }

  const swift = `
import AppKit
import ApplicationServices
import CoreGraphics

let bundleId = "${application.replaceAll('"', '\\"')}"
let searchAttr = "${searchAttr}" as CFString
let searchValue = "${searchValue.replaceAll('"', '\\"')}"

guard let app = NSWorkspace.shared.runningApplications.first(where: { $0.bundleIdentifier == bundleId }) else {
    print("{\\"ok\\": false, \\"error\\": \\"app not found: \\(bundleId)\\"}")
    exit(1)
}

let axApp = AXUIElementCreateApplication(app.processIdentifier)

func findElement(root: AXUIElement, depth: Int = 0) -> AXUIElement? {
    if depth > 20 { return nil }
    var val: CFTypeRef?
    if AXUIElementCopyAttributeValue(root, searchAttr, &val) == .success,
       let str = val as? String, str == searchValue {
        return root
    }
    var children: CFTypeRef?
    guard AXUIElementCopyAttributeValue(root, "AXChildren" as CFString, &children) == .success,
          let arr = children as? [AXUIElement] else { return nil }
    for child in arr {
        if let found = findElement(root: child, depth: depth + 1) { return found }
    }
    return nil
}

guard let el = findElement(root: axApp) else {
    print("{\\"ok\\": false, \\"error\\": \\"element not found\\"}")
    exit(1)
}

if AXUIElementPerformAction(el, "AXPress" as CFString) == .success {
    print("{\\"ok\\": true, \\"method\\": \\"AXPress\\"}")
    exit(0)
}

// Fallback: coordinate click
var posRef: CFTypeRef?
var sizeRef: CFTypeRef?
guard AXUIElementCopyAttributeValue(el, "AXPosition" as CFString, &posRef) == .success,
      AXUIElementCopyAttributeValue(el, "AXSize" as CFString, &sizeRef) == .success else {
    print("{\\"ok\\": false, \\"error\\": \\"cannot get position\\"}")
    exit(1)
}
var pt = CGPoint.zero; var sz = CGSize.zero
AXValueGetValue(posRef as! AXValue, .cgPoint, &pt)
AXValueGetValue(sizeRef as! AXValue, .cgSize, &sz)
let cx = pt.x + sz.width / 2, cy = pt.y + sz.height / 2
CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: CGPoint(x: cx, y: cy), mouseButton: .left)?.post(tap: .cghidEventTap)
CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: CGPoint(x: cx, y: cy), mouseButton: .left)?.post(tap: .cghidEventTap)
print("{\\"ok\\": true, \\"method\\": \\"coordinate_click\\", \\"x\\": \\(cx), \\"y\\": \\(cy)}")
`;

  const result = await swiftRunner.execute(pi, swift, signal);

  const stdout = result.stdout.trim();
  try {
    const parsed = JSON.parse(stdout) as {
      ok: boolean;
      method?: string;
      error?: string;
      x?: number;
      y?: number;
    };
    if (parsed.ok) {
      return {
        ok: true,
        backend: BACKEND,
        data: {
          method: parsed.method,
          note: "AXPress via direct AXUIElementPerformAction (axorc fallback)",
        },
      };
    }
    return {
      ok: false,
      backend: BACKEND,
      errors: [
        err(
          parsed.error ?? "AXPress fallback failed",
          "AXPRESS_FALLBACK_FAILED",
        ),
      ],
    };
  } catch {
    return {
      ok: false,
      backend: BACKEND,
      errors: [
        err(
          result.stderr.trim() || stdout || "swift tap fallback failed",
          "AXPRESS_FALLBACK_FAILED",
        ),
      ],
      data: { exitCode: result.exitCode, stdout, stderr: result.stderr.trim() },
    };
  }
}

async function typeAction(
  pi: ExtensionAPI,
  application: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<UiActionResult> {
  const text = params.text as string | undefined;
  if (!text) {
    return {
      ok: false,
      backend: BACKEND,
      errors: [err("type requires 'text' param", "MISSING_PARAMS")],
    };
  }

  const locator = buildLocator(params);

  // Try AXSetValue first (works on AppKit text fields, web content, etc.)
  if (locator) {
    const result = await axorc.performAction(
      pi,
      {
        application,
        locator,
        actionName: "AXSetValue",
        actionValue: text,
        maxDepth: 10,
      },
      signal,
    );
    if (result.ok) return mapAxorcResult(result);

    // AXSetValue failed (common with SwiftUI TextField on macOS).
    // Fallback: tap to focus, then simulate keystrokes via System Events.
    return typeViaKeystrokeFallback(pi, application, params, text, signal);
  }

  // No locator: try setFocusedValue, then keystroke fallback.
  const result = await axorc.setFocusedValue(
    pi,
    { application, value: text },
    signal,
  );
  if (result.ok) return mapAxorcResult(result);

  return typeViaKeystrokeFallback(pi, application, {}, text, signal);
}

/**
 * Fallback for typing when AXSetValue is not supported (e.g. SwiftUI TextField).
 * Taps the element to focus it (if params have a locator), then sends keystrokes
 * via osascript System Events.
 */
async function typeViaKeystrokeFallback(
  pi: ExtensionAPI,
  application: string,
  params: Record<string, unknown>,
  text: string,
  signal?: AbortSignal,
): Promise<UiActionResult> {
  // Tap to focus if we have locator params.
  const locator = buildLocator(params);
  if (locator) {
    const tapResult = await tap(pi, application, params, signal);
    if (!tapResult.ok) {
      return {
        ok: false,
        backend: BACKEND,
        errors: [
          err(
            "AXSetValue not supported and tap-to-focus failed",
            "TYPE_FALLBACK_FAILED",
          ),
        ],
        data: tapResult.data,
      };
    }
    // Brief pause for focus to settle.
    await new Promise((r) => setTimeout(r, 100));
  }

  // Escape single quotes for osascript.
  const escaped = text.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const script = `tell application "System Events" to keystroke "${escaped}"`;
  const result = await osascript.evaluate(pi, script, signal);

  if (!result.ok) {
    return {
      ok: false,
      backend: BACKEND,
      errors: [
        err(
          `keystroke fallback failed: ${result.stderr}`,
          "KEYSTROKE_FALLBACK_FAILED",
        ),
      ],
    };
  }

  return {
    ok: true,
    backend: BACKEND,
    data: { typed: text, method: "keystroke_fallback" },
  };
}

async function clearText(
  pi: ExtensionAPI,
  application: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<UiActionResult> {
  const locator = buildLocator(params);
  if (!locator) {
    return {
      ok: false,
      backend: BACKEND,
      errors: [
        err(
          "clear_text requires at least one of: identifier, title, role",
          "MISSING_PARAMS",
        ),
      ],
    };
  }

  const result = await axorc.performAction(
    pi,
    {
      application,
      locator,
      actionName: "AXSetValue",
      actionValue: "",
      maxDepth: 10,
    },
    signal,
  );
  return mapAxorcResult(result);
}

async function queryText(
  pi: ExtensionAPI,
  application: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<UiActionResult> {
  const locator = buildLocator(params);

  const result = await axorc.extractText(
    pi,
    {
      application,
      ...(locator ? { locator } : {}),
      includeChildren: true,
      maxDepth: 10,
    },
    signal,
  );
  if (!result.ok) {
    return {
      ok: false,
      backend: BACKEND,
      errors: [err(result.error ?? "extractText failed", "AXORC_ERROR")],
      data: result.data,
    };
  }

  // extractText returns { text: "..." }
  const data = result.data as AxorcExtractTextData | undefined;
  const text = data?.text ?? "";

  return {
    ok: true,
    backend: BACKEND,
    data: { text, matches: text ? [text] : [] },
  };
}

async function waitFor(
  pi: ExtensionAPI,
  application: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<UiActionResult> {
  const locator = buildLocator(params);
  if (!locator) {
    return {
      ok: false,
      backend: BACKEND,
      errors: [
        err(
          "wait_for requires at least one of: identifier, title, role",
          "MISSING_PARAMS",
        ),
      ],
    };
  }

  const timeout = typeof params.timeout === "number" ? params.timeout : 10;
  const interval = 500;
  const maxAttempts = Math.ceil((timeout * 1000) / interval);

  for (let i = 0; i < maxAttempts; i++) {
    if (signal?.aborted) {
      return {
        ok: false,
        backend: BACKEND,
        errors: [err("aborted", "ABORTED")],
      };
    }

    const result = await axorc.query(
      pi,
      {
        application,
        locator,
        attributes: ["AXRole", "AXTitle", "AXIdentifier", "AXEnabled"],
        maxDepth: 10,
      },
      signal,
    );

    if (result.ok) {
      return {
        ok: true,
        backend: BACKEND,
        data: { found: true, attempts: i + 1, ...(result.data as object) },
      };
    }

    if (i < maxAttempts - 1) {
      await sleep(interval, signal);
    }
  }

  return {
    ok: false,
    backend: BACKEND,
    errors: [
      err(
        `element not found after ${timeout}s`,
        "WAIT_TIMEOUT",
        "element may not exist or criteria may be too strict",
      ),
    ],
  };
}

async function assertElement(
  pi: ExtensionAPI,
  application: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<UiActionResult> {
  const locator = buildLocator(params);
  if (!locator) {
    return {
      ok: false,
      backend: BACKEND,
      errors: [
        err(
          "assert requires at least one of: identifier, title, role",
          "MISSING_PARAMS",
        ),
      ],
    };
  }

  const result = await axorc.query(
    pi,
    {
      application,
      locator,
      attributes: ["AXRole", "AXTitle", "AXIdentifier", "AXValue", "AXEnabled"],
      maxDepth: 10,
    },
    signal,
  );

  if (!result.ok) {
    return {
      ok: false,
      backend: BACKEND,
      errors: [
        err("element not found", "ASSERT_NOT_FOUND", "check locator criteria"),
      ],
    };
  }

  // Check optional value assertion against the queried element.
  const expectedValue = params.value as string | undefined;
  if (expectedValue !== undefined) {
    const elData = result.data as AxorcElementData | undefined;
    const actual = unwrapString(elData?.attributes?.AXValue);
    if (actual !== expectedValue) {
      return {
        ok: false,
        backend: BACKEND,
        data: { expected: expectedValue, actual: actual ?? null },
        errors: [
          err(
            `expected value '${expectedValue}', got '${actual ?? "(none)"}'`,
            "ASSERT_VALUE_MISMATCH",
          ),
        ],
      };
    }
  }

  return {
    ok: true,
    backend: BACKEND,
    data: { found: true, ...(result.data as object) },
  };
}

async function screenshot(
  pi: ExtensionAPI,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<UiActionResult> {
  const path = params.path
    ? String(params.path)
    : await makeDefaultArtifactPath("screenshots", "png");

  const result = await screencaptureLib.capture(pi, path, signal);
  if (!result.ok) {
    return {
      ok: false,
      backend: BACKEND,
      errors: [
        err(result.stderr || "screencapture failed", "SCREENSHOT_FAILED"),
      ],
    };
  }

  return {
    ok: true,
    backend: BACKEND,
    artifacts: { screenshot: path },
    data: { path },
  };
}

// ---------------------------------------------------------------------------
// Locator
// ---------------------------------------------------------------------------

interface AxorcLocator {
  criteria: Array<{
    attribute: string;
    value: string;
    match_type?: string;
  }>;
  match_all?: boolean;
  /** When set, only match elements that support this action (e.g. "AXPress"). */
  require_action?: string;
}

function buildLocator(params: Record<string, unknown>): AxorcLocator | null {
  const criteria: AxorcLocator["criteria"] = [];

  if (typeof params.identifier === "string") {
    criteria.push({
      attribute: "AXIdentifier",
      value: params.identifier,
      match_type: "exact",
    });
  }
  if (typeof params.title === "string") {
    criteria.push({
      attribute: "AXTitle",
      value: params.title,
      match_type: "exact",
    });
  }
  if (typeof params.role === "string") {
    criteria.push({
      attribute: "AXRole",
      value: params.role,
      match_type: "exact",
    });
  }
  if (typeof params.description === "string") {
    criteria.push({
      attribute: "AXDescription",
      value: params.description,
      match_type: "contains",
    });
  }
  if (typeof params.placeholder === "string") {
    criteria.push({
      attribute: "AXPlaceholderValue",
      value: params.placeholder,
      match_type: "contains",
    });
  }
  if (typeof params.label === "string") {
    criteria.push({
      attribute: "AXTitle",
      value: params.label,
      match_type: "exact",
    });
  }
  if (typeof params.value === "string" && criteria.length === 0) {
    criteria.push({
      attribute: "AXValue",
      value: params.value,
      match_type: "contains",
    });
  }

  if (criteria.length === 0) return null;
  return { criteria, match_all: true };
}

// ---------------------------------------------------------------------------
// Element normalization
// ---------------------------------------------------------------------------

function normalizeElement(el: AxorcElementData): Record<string, unknown> {
  const attrs = el.attributes ?? {};
  const brief = el.brief_description ?? "";
  const textContent = el.textual_content ?? "";
  const parsed = parseBriefDescription(brief);

  const role = unwrapString(attrs.AXRole) ?? el.role ?? parsed.role ?? "";
  const title = unwrapString(attrs.AXTitle) ?? parsed.title ?? textContent;
  const identifier = unwrapString(attrs.AXIdentifier) ?? parsed.id ?? "";
  const value = unwrapString(attrs.AXValue) ?? "";
  const enabled = unwrapBool(attrs.AXEnabled);
  const description = unwrapString(attrs.AXDescription) ?? "";
  const placeholder = unwrapString(attrs.AXPlaceholderValue) ?? "";

  const out: Record<string, unknown> = {
    role,
    title,
    identifier,
    value,
    description,
    placeholder,
  };
  if (enabled !== undefined) out.enabled = enabled;
  if (textContent && textContent !== title) out.text = textContent;
  return out;
}

function parseBriefDescription(brief: string): {
  role?: string;
  title?: string;
  id?: string;
} {
  if (!brief) return {};
  const result: { role?: string; title?: string; id?: string } = {};

  const roleMatch = brief.match(/Role:\s*(\S+)/);
  if (roleMatch) result.role = roleMatch[1].replace(/,\s*$/, "");

  const titleMatch = brief.match(/Title:\s*'([^']*)'/);
  if (titleMatch) result.title = titleMatch[1];

  const idMatch = brief.match(/ID:\s*'([^']*)'/);
  if (idMatch) result.id = idMatch[1];

  return result;
}

// ---------------------------------------------------------------------------
// App resolution
// ---------------------------------------------------------------------------

async function resolveApplicationId(
  pi: ExtensionAPI,
  application: string,
  signal?: AbortSignal,
): Promise<string> {
  if (application.includes(".")) return application;

  const result = await osascript.evaluate(
    pi,
    `id of app "${application}"`,
    signal,
  );

  if (result.ok && result.output && result.output.includes(".")) {
    return result.output;
  }

  // Fallback: return as-is, let axorc try (works for some system apps).
  return application;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapAxorcResult(result: axorc.AxorcResult): UiActionResult {
  if (result.ok) {
    return { ok: true, backend: BACKEND, data: result.data };
  }
  return {
    ok: false,
    backend: BACKEND,
    errors: [err(result.error ?? "axorc command failed", "AXORC_ERROR")],
    data: result.data,
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}
