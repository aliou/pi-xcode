import type { XcodeToolError } from "../errors";

export type UiBackendName = "xcuitest" | "idb" | "axorcist";
export type UiBackendMode = "auto" | UiBackendName;

export interface UiActionContext {
  action: string;
  deviceId?: string;
  /** Target application name or bundle id (axorcist backend). */
  application?: string;
  backendMode?: UiBackendMode;
  runnerCommand?: string;
  params?: Record<string, unknown>;
}

export interface UiActionResult {
  ok: boolean;
  backend: UiBackendName;
  data?: unknown;
  artifacts?: Record<string, string>;
  warnings?: string[];
  errors?: XcodeToolError[];
}
