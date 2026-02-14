/**
 * TypeScript types matching AXorcist (axorc) JSON output structures.
 * Derived from the Swift source at github.com/steipete/AXorcist.
 *
 * Top-level envelope: AxorcResponse
 * Element data:       AxorcElementData
 * Attribute values:   AxorcValueWrapper → AxorcAttributeValue
 */

// ---------------------------------------------------------------------------
// Top-level response envelope
// ---------------------------------------------------------------------------

export interface AxorcResponse {
  command_id: string;
  command_type?: string;
  success?: boolean;
  status: "success" | "error";
  data?: unknown;
  error?: string | { message: string };
  debug_logs?: string[];
}

// ---------------------------------------------------------------------------
// Error codes returned by axorc
// ---------------------------------------------------------------------------

export type AxorcErrorCode =
  | "element_not_found"
  | "action_failed"
  | "attribute_not_found"
  | "invalid_command"
  | "unknown_command"
  | "internal_error"
  | "permission_denied"
  | "invalid_parameter"
  | "timeout"
  | "observation_failed"
  | "application_not_found"
  | "batch_operation_failed"
  | "action_not_supported";

// ---------------------------------------------------------------------------
// Attribute values
// ---------------------------------------------------------------------------

/**
 * Recursive attribute value. axorc encodes typed values inside an object:
 *   { string: "hello" }
 *   { bool: true }
 *   { int: 42 }
 *   { double: 3.14 }
 *   { array: [...] }
 *   { dictionary: { ... } }
 *   null
 *
 * When the value is present but can't be cleanly serialized, it's `null`.
 */
export type AxorcAttributeValue =
  | { string: string }
  | { bool: boolean }
  | { int: number }
  | { double: number }
  | { array: AxorcAttributeValue[] }
  | { dictionary: Record<string, AxorcAttributeValue> }
  | null;

/**
 * Wrapper around an attribute value.
 * `{ anyValue: <AxorcAttributeValue> }` when the attribute exists.
 * `{}` when the attribute is nil / not set.
 *
 * Note: camelCase `anyValue` in actual JSON due to Swift JSONEncoder defaults,
 * but axorc uses snake_case keys, so it appears as `any_value`.
 */
export interface AxorcValueWrapper {
  any_value?: AxorcAttributeValue | null;
  anyValue?: AxorcAttributeValue | null;
}

// ---------------------------------------------------------------------------
// Element data (returned by collectAll, query, describeElement, etc.)
// ---------------------------------------------------------------------------

export interface AxorcElementData {
  /** Human-readable one-liner, e.g. "Role: AXButton, Title: 'Save', ID: 'btn1'" */
  brief_description?: string;
  /** AX role string, e.g. "AXButton" */
  role?: string;
  /** Requested attributes keyed by name */
  attributes?: Record<string, AxorcValueWrapper>;
  /** All attribute names the element supports */
  all_possible_attributes?: string[];
  /** Concatenated text content of the element and children */
  textual_content?: string;
  /** Brief descriptions of direct children */
  children_brief_descriptions?: string[];
  /** Verbose description including position/size */
  full_ax_description?: string;
  /** Path from root to this element */
  path?: string[];
}

// ---------------------------------------------------------------------------
// Command-specific response payloads
// ---------------------------------------------------------------------------

/** collectAll: { elements: [...], count: N } */
export interface AxorcCollectAllData {
  elements: AxorcElementData[];
  count: number;
}

/** extractText: { text: "..." } */
export interface AxorcExtractTextData {
  text: string;
}

/** performAction / setFocusedValue: { message: "..." } */
export interface AxorcMessageData {
  message: string;
}

/** batch: { results: [...], errors: [...] } */
export interface AxorcBatchData {
  results?: (unknown | null)[];
  errors?: string[];
}

/** describeElement (recursive tree) */
export interface AxorcElementDescription {
  brief_description?: string;
  role?: string;
  attributes?: Record<string, AxorcValueWrapper>;
  children?: AxorcElementDescription[];
}

/** getAttributes: { attributes: {...}, element_description: "..." } */
export interface AxorcGetAttributesData {
  attributes: Record<string, AxorcValueWrapper>;
  element_description: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a string from an AxorcValueWrapper.
 * Handles both `any_value` and `anyValue` key variants, and both
 * `{ string: "x" }` typed values and bare `null` (attribute present but opaque).
 */
export function unwrapString(
  w: AxorcValueWrapper | undefined,
): string | undefined {
  if (!w) return undefined;
  const av = w.any_value ?? w.anyValue;
  if (av === null || av === undefined) return undefined;
  if (typeof av === "object" && "string" in av) return av.string;
  return undefined;
}

/**
 * Extract a boolean from an AxorcValueWrapper.
 */
export function unwrapBool(
  w: AxorcValueWrapper | undefined,
): boolean | undefined {
  if (!w) return undefined;
  const av = w.any_value ?? w.anyValue;
  if (av === null || av === undefined) return undefined;
  if (typeof av === "object" && "bool" in av) return av.bool;
  return undefined;
}

/**
 * Extract a number from an AxorcValueWrapper.
 */
export function unwrapNumber(
  w: AxorcValueWrapper | undefined,
): number | undefined {
  if (!w) return undefined;
  const av = w.any_value ?? w.anyValue;
  if (av === null || av === undefined) return undefined;
  if (typeof av === "object" && "int" in av) return av.int;
  if (typeof av === "object" && "double" in av) return av.double;
  return undefined;
}

/**
 * Check if wrapper has a value present (even if opaque).
 * `{}` means nil/absent. `{ any_value: null }` means present but opaque.
 */
export function hasValue(w: AxorcValueWrapper | undefined): boolean {
  if (!w) return false;
  return "any_value" in w || "anyValue" in w;
}
