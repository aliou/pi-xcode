import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { formatErrors, parseData, relPath } from "../components/render-helpers";
import { XcodeToolCall } from "../components/XcodeToolCall";
import { XcodeToolResult } from "../components/XcodeToolResult";
import * as simctl from "../libs/simctl";
import {
  err,
  formatResult,
  validateAction,
  type XcodeToolError,
} from "../utils/errors";
import { run } from "../utils/exec";

const SIMULATOR_ACTIONS = [
  "list",
  "status",
  "boot",
  "shutdown",
  "erase",
  "install",
  "uninstall",
  "launch",
  "terminate",
  "open_url",
  "set_permission",
  "set_location",
  "set_appearance",
  "set_locale",
  "biometric",
  "reset_app_data",
  "seed_data",
  "get_app_container",
  "list_apps",
  "app_info",
  "read_defaults",
  "write_defaults",
  "read_container_file",
  "write_container_file",
] as const;

const Params = Type.Object({
  action: StringEnum(SIMULATOR_ACTIONS),
  deviceId: Type.Optional(Type.String()),
  appPath: Type.Optional(Type.String()),
  bundleId: Type.Optional(Type.String()),
  args: Type.Optional(Type.Array(Type.String())),
  env: Type.Optional(Type.Record(Type.String(), Type.String())),
  url: Type.Optional(Type.String()),
  service: Type.Optional(Type.String()),
  value: Type.Optional(Type.String()),
  latitude: Type.Optional(Type.Number()),
  longitude: Type.Optional(Type.Number()),
  appearance: Type.Optional(StringEnum(["light", "dark"] as const)),
  locale: Type.Optional(Type.String()),
  languageCode: Type.Optional(Type.String()),
  event: Type.Optional(
    StringEnum(["enroll", "unenroll", "match", "nomatch"] as const),
  ),
  biometricType: Type.Optional(StringEnum(["face", "finger"] as const)),
  sourcePath: Type.Optional(Type.String()),
  destinationPath: Type.Optional(Type.String()),
  containerType: Type.Optional(Type.String()),
  domain: Type.Optional(Type.String()),
  key: Type.Optional(Type.String()),
  path: Type.Optional(Type.String()),
  content: Type.Optional(Type.String()),
});

interface ToolParams {
  action: string;
  [key: string]: unknown;
}

function requireFields(
  action: string,
  params: ToolParams,
  fields: string[],
): ReturnType<typeof formatResult> | undefined {
  const missing = fields.filter(
    (f) => params[f] === undefined || params[f] === null || params[f] === "",
  );
  if (missing.length === 0) return undefined;
  return formatResult(action, "Missing required argument(s)", {
    ok: false,
    action,
    errors: [
      err(`${action} requires: ${missing.join(", ")}`, "VALIDATION_FAILED"),
    ],
  });
}

export function registerXcodeSimulatorTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "xcode_simulator",
    label: "Xcode Simulator",
    description:
      "Simulator lifecycle and runtime controls. Actions include list/status/boot/install/launch/list_apps/app_info/defaults/container ops.",
    parameters: Params,

    async execute(_toolCallId, rawParams, signal) {
      const params = rawParams as ToolParams;
      const action = params.action;

      const actionError = validateAction(
        "xcode_simulator",
        params.action,
        SIMULATOR_ACTIONS,
      );
      if (actionError) {
        return formatResult(
          String(params.action ?? "unknown"),
          "Invalid action",
          {
            ok: false,
            action: String(params.action ?? "unknown"),
            errors: [actionError],
          },
        );
      }

      if (action === "list") return list(pi, signal);

      if (action === "status") return status(pi, params, signal);

      if (action === "boot") {
        const invalid = requireFields("boot", params, ["deviceId"]);
        if (invalid) return invalid;
        return boot(pi, params, signal);
      }

      if (action === "shutdown") return shutdown(pi, params, signal);

      if (action === "erase") {
        const invalid = requireFields("erase", params, ["deviceId"]);
        if (invalid) return invalid;
        return erase(pi, params, signal);
      }

      if (action === "install") {
        const invalid = requireFields("install", params, ["appPath"]);
        if (invalid) return invalid;
        return install(pi, params, signal);
      }

      if (action === "uninstall") {
        const invalid = requireFields("uninstall", params, ["bundleId"]);
        if (invalid) return invalid;
        return uninstall(pi, params, signal);
      }

      if (action === "launch") {
        const invalid = requireFields("launch", params, ["bundleId"]);
        if (invalid) return invalid;
        return launch(pi, params, signal);
      }

      if (action === "terminate") {
        const invalid = requireFields("terminate", params, ["bundleId"]);
        if (invalid) return invalid;
        return terminate(pi, params, signal);
      }

      if (action === "open_url") {
        const invalid = requireFields("open_url", params, ["url"]);
        if (invalid) return invalid;
        return openUrl(pi, params, signal);
      }

      if (action === "set_permission") {
        const invalid = requireFields("set_permission", params, [
          "service",
          "bundleId",
          "value",
        ]);
        if (invalid) return invalid;
        return setPermission(pi, params, signal);
      }

      if (action === "set_location") {
        const invalid = requireFields("set_location", params, [
          "latitude",
          "longitude",
        ]);
        if (invalid) return invalid;
        return setLocation(pi, params, signal);
      }

      if (action === "set_appearance") {
        const invalid = requireFields("set_appearance", params, ["appearance"]);
        if (invalid) return invalid;
        return setAppearance(pi, params, signal);
      }

      if (action === "set_locale") {
        const invalid = requireFields("set_locale", params, ["locale"]);
        if (invalid) return invalid;
        return setLocale(pi, params, signal);
      }

      if (action === "biometric") {
        const invalid = requireFields("biometric", params, ["event"]);
        if (invalid) return invalid;
        return biometric(pi, params, signal);
      }

      if (action === "reset_app_data") {
        const invalid = requireFields("reset_app_data", params, ["bundleId"]);
        if (invalid) return invalid;
        return resetAppData(pi, params, signal);
      }

      if (action === "seed_data") {
        const invalid = requireFields("seed_data", params, [
          "bundleId",
          "sourcePath",
          "destinationPath",
        ]);
        if (invalid) return invalid;
        return seedData(pi, params, signal);
      }

      if (action === "get_app_container") {
        const invalid = requireFields("get_app_container", params, [
          "bundleId",
        ]);
        if (invalid) return invalid;
        return getAppContainerAction(pi, params, signal);
      }

      if (action === "list_apps") return listApps(pi, params, signal);

      if (action === "app_info") {
        const invalid = requireFields("app_info", params, ["bundleId"]);
        if (invalid) return invalid;
        return appInfo(pi, params, signal);
      }

      if (action === "read_defaults") {
        const invalid = requireFields("read_defaults", params, ["domain"]);
        if (invalid) return invalid;
        return readDefaults(pi, params, signal);
      }

      if (action === "write_defaults") {
        const invalid = requireFields("write_defaults", params, [
          "domain",
          "key",
          "value",
        ]);
        if (invalid) return invalid;
        return writeDefaults(pi, params, signal);
      }

      if (action === "read_container_file") {
        const invalid = requireFields("read_container_file", params, ["path"]);
        if (invalid) return invalid;
        return readContainerFile(params);
      }

      if (action === "write_container_file") {
        const invalid = requireFields("write_container_file", params, [
          "path",
          "content",
        ]);
        if (invalid) return invalid;
        return writeContainerFile(params);
      }

      return formatResult(action, "Unsupported action", {
        ok: false,
        action,
        errors: [err(`Unsupported action '${action}'`)],
      });
    },

    renderCall(args, theme) {
      const call = args as unknown as Record<string, string | undefined>;
      const fields: { label: string; value: string }[] = [
        { label: "Action", value: call.action ?? "unknown" },
      ];
      if (call.deviceId) fields.push({ label: "Device", value: call.deviceId });
      if (call.bundleId) fields.push({ label: "Bundle", value: call.bundleId });
      return new XcodeToolCall({ label: "Simulator", fields }, theme);
    },

    renderResult(result, options, theme) {
      const details = result.details as
        | {
            ok?: boolean;
            action?: string;
            errors?: XcodeToolError[];
            warnings?: string[];
            data?: unknown;
          }
        | undefined;

      const data = parseData(details?.data);
      const ok = details?.ok ?? false;
      const action = details?.action ?? "";
      const errors = details?.errors;
      const warnings = details?.warnings as string[] | undefined;

      let summary = "";
      let detail = "";

      switch (action) {
        case "list": {
          const devices = (data?.devices as unknown[]) ?? [];
          const booted =
            (data?.booted as Array<{
              name?: string;
              udid?: string;
              runtime?: string;
            }>) ?? [];
          summary = `${devices.length} simulator${devices.length !== 1 ? "s" : ""} (${booted.length} booted)`;
          if (options.expanded) {
            const lines: string[] = [];
            if (booted.length > 0) {
              lines.push("**Booted:**");
              for (const d of booted) {
                lines.push(
                  `- **${d.name ?? "Unknown"}** — ${d.udid ?? ""} (${d.runtime ?? ""})`,
                );
              }
              lines.push("");
            }
            lines.push(
              `Total: ${devices.length} simulator${devices.length !== 1 ? "s" : ""}`,
            );
            detail = lines.join("\n");
          }
          break;
        }

        case "status": {
          const booted =
            (data?.booted as Array<{
              name?: string;
              udid?: string;
              runtime?: string;
              state?: string;
            }>) ?? [];
          const device = data?.device as
            | {
                name?: string;
                udid?: string;
                runtime?: string;
                state?: string;
              }
            | undefined;
          if (device) {
            summary = `${device.name ?? "Unknown"}: ${device.state ?? "Unknown"}`;
            if (options.expanded) {
              detail = [
                `- **Name:** ${device.name ?? "Unknown"}`,
                `- **UDID:** ${device.udid ?? "Unknown"}`,
                `- **Runtime:** ${device.runtime ?? "Unknown"}`,
                `- **State:** ${device.state ?? "Unknown"}`,
              ].join("\n");
            }
          } else if (booted.length > 0) {
            const first = booted[0] as Record<string, unknown>;
            summary = `${first.name ?? "Unknown"}: ${first.state ?? "Booted"}`;
            if (options.expanded) {
              detail = booted
                .map(
                  (d) =>
                    `- **${d.name ?? "Unknown"}** — ${d.udid ?? ""} (${d.runtime ?? ""})`,
                )
                .join("\n");
            }
          } else {
            summary = "no booted simulators";
          }
          break;
        }

        case "boot": {
          // boot's data only has { stdout, stderr } — extract deviceId from content text
          const contentText = result.content[0];
          const output = contentText?.type === "text" ? contentText.text : "";
          const deviceId =
            output.replace(/^(?:Booted|Failed to boot)\s+/i, "").trim() || "";
          summary = ok ? `booted ${deviceId}` : `failed to boot ${deviceId}`;
          if (options.expanded) {
            detail = deviceId;
          }
          break;
        }

        case "shutdown": {
          const target = (data?.target as string) ?? "";
          summary = ok ? `shutdown ${target}` : `failed to shutdown ${target}`;
          if (options.expanded) {
            detail = target;
          }
          break;
        }

        case "erase": {
          const target = (data?.target as string) ?? "";
          summary = ok ? `erased ${target}` : `failed to erase ${target}`;
          if (options.expanded) {
            detail = target;
          }
          break;
        }

        case "install": {
          const appPath = (data?.target as string) ?? "";
          summary = ok
            ? `installed \`${relPath(appPath)}\``
            : `failed to install \`${relPath(appPath)}\``;
          if (options.expanded) {
            const lines: string[] = [`**Path:** \`${relPath(appPath)}\``];
            const device = (data?.device as string) ?? "";
            if (device) lines.push(`**Device:** ${device}`);
            detail = lines.join("\n");
          }
          break;
        }

        case "uninstall": {
          const bundleId = (data?.target as string) ?? "";
          summary = ok
            ? `uninstalled \`${bundleId}\``
            : `failed to uninstall \`${bundleId}\``;
          if (options.expanded) {
            const lines: string[] = [`**Bundle ID:** \`${bundleId}\``];
            const device = (data?.device as string) ?? "";
            if (device) lines.push(`**Device:** ${device}`);
            detail = lines.join("\n");
          }
          break;
        }

        case "launch": {
          const bundleId = (data?.target as string) ?? "";
          const stdout = (data?.stdout as string) ?? "";
          summary = ok
            ? `launched \`${bundleId}\``
            : `failed to launch \`${bundleId}\``;
          if (options.expanded) {
            const lines: string[] = [`**Bundle ID:** \`${bundleId}\``];
            const pidMatch = stdout.match(/:\s*(\d+)/);
            if (pidMatch?.[1]) lines.push(`**PID:** ${pidMatch[1]}`);
            const device = (data?.device as string) ?? "";
            if (device) lines.push(`**Device:** ${device}`);
            detail = lines.join("\n");
          }
          break;
        }

        case "terminate": {
          const bundleId = (data?.target as string) ?? "";
          summary = ok
            ? `terminated \`${bundleId}\``
            : `failed to terminate \`${bundleId}\``;
          if (options.expanded) {
            const lines: string[] = [`**Bundle ID:** \`${bundleId}\``];
            const device = (data?.device as string) ?? "";
            if (device) lines.push(`**Device:** ${device}`);
            detail = lines.join("\n");
          }
          break;
        }

        case "list_apps": {
          const bundleIds = (data?.bundleIds as string[] | undefined) ?? [];
          const device = (data?.device as string) ?? "";
          summary = `${bundleIds.length} app${bundleIds.length !== 1 ? "s" : ""} installed`;
          if (options.expanded) {
            const lines: string[] = [];
            if (device) lines.push(`**Device:** ${device}\n`);
            for (const id of bundleIds) {
              lines.push(`- \`${id}\``);
            }
            detail = lines.join("\n");
          }
          break;
        }

        case "app_info": {
          const bundleId = (data?.bundleId as string) ?? "";
          const device = (data?.device as string) ?? "";
          const info = parseData(data?.info);
          summary = ok
            ? `\`${bundleId}\` info retrieved`
            : `failed to get info for \`${bundleId}\``;
          if (options.expanded) {
            const lines: string[] = [];
            if (device) lines.push(`**Device:** ${device}`);
            if (info) {
              if (info.ApplicationType)
                lines.push(`**ApplicationType:** ${info.ApplicationType}`);
              if (info.CFBundleVersion)
                lines.push(`**CFBundleVersion:** ${info.CFBundleVersion}`);
              if (info.Path)
                lines.push(`**Path:** \`${relPath(String(info.Path))}\``);
            }
            detail = lines.join("\n");
          }
          break;
        }

        case "read_defaults": {
          const domain = (data?.domain as string) ?? "";
          const key = (data?.key as string) ?? "";
          const value = (data?.value as string) ?? "";
          summary = `defaults: ${domain}${key ? `.${key}` : ""}`;
          if (options.expanded) {
            const lines: string[] = [`**Domain:** ${domain}`];
            if (key) lines.push(`**Key:** ${key}`);
            if (value) lines.push(`**Value:**\n\`\`\`\n${value}\n\`\`\``);
            detail = lines.join("\n");
          }
          break;
        }

        case "write_defaults": {
          const domain = (data?.domain as string) ?? "";
          const key = (data?.key as string) ?? "";
          const value = (data?.value as string) ?? "";
          summary = ok
            ? `wrote ${domain}.${key}`
            : `failed to write ${domain}.${key}`;
          if (options.expanded) {
            detail = [
              `**Domain:** ${domain}`,
              `**Key:** ${key}`,
              `**Value:** ${value}`,
            ].join("\n");
          }
          break;
        }

        default: {
          const target = (data?.target as string) ?? "";
          summary = ok
            ? target
              ? `${action} ok: ${target}`
              : `${action} ok`
            : target
              ? `${action} failed: ${target}`
              : `${action} failed`;
          if (options.expanded) {
            const contentText = result.content[0];
            const output = contentText?.type === "text" ? contentText.text : "";
            if (output) detail = output;
          }
          break;
        }
      }

      // Append formatted errors (visible in expanded view via detail)
      const errorText = formatErrors(errors);
      if (errorText) {
        detail = detail ? `${detail}\n\n${errorText}` : errorText;
      }

      // Append warnings as blockquotes
      if (warnings && warnings.length > 0) {
        const warningText = warnings.map((w) => `> ⚠️ ${w}`).join("\n");
        detail = detail ? `${detail}\n\n${warningText}` : warningText;
      }

      return new XcodeToolResult(
        {
          summary,
          succeeded: ok,
          detail: detail || undefined,
        },
        options,
        theme,
      );
    },
  });
}

async function list(pi: ExtensionAPI, signal?: AbortSignal) {
  const result = await simctl.listDevices(pi, signal);
  if (!result.ok) {
    return formatResult("list", "Failed to list simulators", {
      ok: false,
      action: "list",
      errors: [err(result.stderr ?? "unknown error", "SIM_LIST_FAILED")],
    });
  }

  return formatResult("list", `Found ${result.devices.length} simulators`, {
    ok: true,
    action: "list",
    data: {
      devices: result.devices,
      booted: result.devices.filter((d) => d.state === "Booted"),
    },
  });
}

async function status(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const result = await simctl.listDevices(pi, signal);
  if (!result.ok) {
    return formatResult("status", "Failed to get simulator status", {
      ok: false,
      action: "status",
      errors: [err(result.stderr ?? "unknown error", "SIM_STATUS_FAILED")],
    });
  }

  const requested = params.deviceId as string | undefined;
  const booted = result.devices.filter((d) => d.state === "Booted");

  if (!requested) {
    return formatResult(
      "status",
      `Found ${booted.length} booted simulator(s)`,
      {
        ok: true,
        action: "status",
        data: {
          booted,
        },
        warnings:
          booted.length === 0 ? ["no booted simulator detected"] : undefined,
      },
    );
  }

  const device = result.devices.find((d) => d.udid === requested);
  if (!device) {
    return formatResult("status", `Simulator not found: ${requested}`, {
      ok: false,
      action: "status",
      errors: [
        err(`Unknown simulator deviceId: ${requested}`, "SIM_NOT_FOUND"),
      ],
    });
  }

  return formatResult("status", `${device.name}: ${device.state}`, {
    ok: true,
    action: "status",
    data: {
      device,
    },
  });
}

async function boot(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const deviceId = String(params.deviceId);
  const result = await simctl.boot(pi, deviceId, signal);
  const bootStatus = await simctl.bootStatus(pi, deviceId, signal);
  const ok = result.exitCode === 0 || bootStatus.exitCode === 0;

  return formatResult(
    "boot",
    ok ? `Booted ${deviceId}` : `Failed to boot ${deviceId}`,
    {
      ok,
      action: "boot",
      data: {
        stdout: result.stdout,
        stderr: result.stderr,
      },
      errors: ok
        ? undefined
        : [err(result.stderr || result.stdout, "SIM_BOOT_FAILED")],
    },
  );
}

async function shutdown(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const target = simctl.resolveDeviceTarget(
    params.deviceId as string | undefined,
  );
  const result = await simctl.shutdown(pi, target, signal);
  return simpleSimctlResult("shutdown", target, result);
}

async function erase(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const target = String(params.deviceId);
  const result = await simctl.erase(pi, target, signal);
  return simpleSimctlResult("erase", target, result);
}

async function install(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const device = simctl.resolveDeviceTarget(
    params.deviceId as string | undefined,
  );
  const appPath = String(params.appPath);
  const result = await simctl.install(pi, device, appPath, signal);
  return simpleSimctlResult("install", appPath, result);
}

async function uninstall(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const device = simctl.resolveDeviceTarget(
    params.deviceId as string | undefined,
  );
  const bundleId = String(params.bundleId);
  const result = await simctl.uninstall(pi, device, bundleId, signal);
  return simpleSimctlResult("uninstall", bundleId, result);
}

async function launch(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const device = simctl.resolveDeviceTarget(
    params.deviceId as string | undefined,
  );
  const bundleId = String(params.bundleId);
  const env = params.env as Record<string, string> | undefined;
  const appArgs = params.args as string[] | undefined;

  const result = await simctl.launch(
    pi,
    device,
    bundleId,
    { args: appArgs, env },
    signal,
  );
  return simpleSimctlResult("launch", bundleId, result);
}

async function terminate(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const device = simctl.resolveDeviceTarget(
    params.deviceId as string | undefined,
  );
  const bundleId = String(params.bundleId);
  const result = await simctl.terminate(pi, device, bundleId, signal);
  return simpleSimctlResult("terminate", bundleId, result);
}

async function openUrl(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const device = simctl.resolveDeviceTarget(
    params.deviceId as string | undefined,
  );
  const url = String(params.url);
  const result = await simctl.openUrl(pi, device, url, signal);
  return simpleSimctlResult("open_url", url, result);
}

async function setPermission(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const device = simctl.resolveDeviceTarget(
    params.deviceId as string | undefined,
  );
  const value = String(params.value);
  const service = String(params.service);
  const bundleId = String(params.bundleId);

  const result = await simctl.privacy(
    pi,
    device,
    value,
    service,
    bundleId,
    signal,
  );

  return simpleSimctlResult("set_permission", `${service}:${bundleId}`, result);
}

async function setLocation(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const device = simctl.resolveDeviceTarget(
    params.deviceId as string | undefined,
  );
  const lat = String(params.latitude);
  const lon = String(params.longitude);

  const result = await simctl.location(pi, device, lat, lon, signal);
  return simpleSimctlResult("set_location", `${lat},${lon}`, result);
}

async function setAppearance(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const device = simctl.resolveDeviceTarget(
    params.deviceId as string | undefined,
  );
  const appearance = String(params.appearance);

  const result = await simctl.ui(pi, device, "appearance", appearance, signal);
  return simpleSimctlResult("set_appearance", appearance, result);
}

async function setLocale(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const device = simctl.resolveDeviceTarget(
    params.deviceId as string | undefined,
  );
  const locale = String(params.locale);
  const languageCode = String(
    params.languageCode ?? locale.split("_")[0] ?? "en",
  );

  const setLocaleResult = await simctl.spawn(
    pi,
    device,
    ["defaults", "write", "-g", "AppleLocale", locale],
    signal,
  );
  const setLanguageResult = await simctl.spawn(
    pi,
    device,
    ["defaults", "write", "-g", "AppleLanguages", `(${languageCode})`],
    signal,
  );

  const ok = setLocaleResult.exitCode === 0 && setLanguageResult.exitCode === 0;
  return formatResult(
    "set_locale",
    ok ? `Locale set to ${locale}` : "Failed to set locale",
    {
      ok,
      action: "set_locale",
      data: {
        locale,
        languageCode,
      },
      warnings: ["restart app/simulator to ensure locale changes apply"],
      errors: ok
        ? undefined
        : [
            err(
              setLocaleResult.stderr || setLanguageResult.stderr,
              "SIM_SET_LOCALE_FAILED",
            ),
          ],
    },
  );
}

async function biometric(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const device = simctl.resolveDeviceTarget(
    params.deviceId as string | undefined,
  );
  const event = String(params.event);
  const biometricType = String(params.biometricType ?? "face");
  const result = await simctl.biometric(
    pi,
    device,
    event,
    biometricType,
    signal,
  );
  return simpleSimctlResult("biometric", `${event}:${biometricType}`, result);
}

async function resetAppData(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const device = simctl.resolveDeviceTarget(
    params.deviceId as string | undefined,
  );
  const bundleId = String(params.bundleId);

  const terminateResult = await simctl.terminate(pi, device, bundleId, signal);
  const uninstallResult = await simctl.uninstall(pi, device, bundleId, signal);

  const ok = terminateResult.exitCode === 0 || uninstallResult.exitCode === 0;
  return formatResult(
    "reset_app_data",
    ok
      ? `Reset app data for ${bundleId}`
      : `Failed to reset app data for ${bundleId}`,
    {
      ok,
      action: "reset_app_data",
      warnings: [
        "reset_app_data currently uninstalls app. reinstall required.",
      ],
      data: {
        terminate: terminateResult,
        uninstall: uninstallResult,
      },
      errors: ok
        ? undefined
        : [err(uninstallResult.stderr, "SIM_RESET_APP_DATA_FAILED")],
    },
  );
}

async function seedData(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const containerResult = await getAppContainerPath(pi, params, signal);
  if (!containerResult.ok) {
    return formatResult("seed_data", "Failed to seed data", {
      ok: false,
      action: "seed_data",
      errors: [err(containerResult.error, "SIM_GET_CONTAINER_FAILED")],
    });
  }

  const sourcePath = String(params.sourcePath);
  const destinationPath = String(params.destinationPath);
  const finalPath = join(containerResult.containerPath, destinationPath);

  const copyResult = await run(pi, ["cp", "-R", sourcePath, finalPath], signal);
  if (copyResult.exitCode !== 0) {
    return formatResult("seed_data", "Failed to seed data", {
      ok: false,
      action: "seed_data",
      errors: [
        err(copyResult.stderr || copyResult.stdout, "SIM_SEED_DATA_FAILED"),
      ],
    });
  }

  return formatResult("seed_data", "Data seeded", {
    ok: true,
    action: "seed_data",
    data: {
      sourcePath,
      destinationPath: finalPath,
    },
  });
}

async function getAppContainerAction(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const result = await getAppContainerPath(pi, params, signal);
  if (!result.ok) {
    return formatResult("get_app_container", "Failed to get app container", {
      ok: false,
      action: "get_app_container",
      errors: [err(result.error, "SIM_GET_CONTAINER_FAILED")],
    });
  }

  return formatResult("get_app_container", result.containerPath, {
    ok: true,
    action: "get_app_container",
    data: {
      device: result.device,
      bundleId: result.bundleId,
      containerType: result.containerType,
      containerPath: result.containerPath,
    },
  });
}

async function listApps(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const device = simctl.resolveDeviceTarget(
    params.deviceId as string | undefined,
  );
  const result = await simctl.listApps(pi, device, signal);
  if (result.exitCode !== 0) {
    return formatResult("list_apps", "Failed to list installed apps", {
      ok: false,
      action: "list_apps",
      errors: [err(result.stderr || result.stdout, "SIM_LIST_APPS_FAILED")],
    });
  }

  try {
    const apps = JSON.parse(result.stdout) as Record<string, unknown>;
    const bundleIds = Object.keys(apps).sort();
    return formatResult(
      "list_apps",
      `Found ${bundleIds.length} installed app(s)`,
      {
        ok: true,
        action: "list_apps",
        data: {
          device,
          bundleIds,
          apps,
        },
      },
    );
  } catch {
    return formatResult("list_apps", "Listed apps (raw)", {
      ok: true,
      action: "list_apps",
      data: {
        device,
        raw: result.stdout.trim(),
      },
      warnings: ["simctl listapps JSON parse failed. returned raw output."],
    });
  }
}

async function appInfo(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const device = simctl.resolveDeviceTarget(
    params.deviceId as string | undefined,
  );
  const bundleId = String(params.bundleId);

  const result = await simctl.appInfo(pi, device, bundleId, signal);
  if (result.exitCode === 0) {
    try {
      const info = JSON.parse(result.stdout) as unknown;
      return formatResult("app_info", `App info found for ${bundleId}`, {
        ok: true,
        action: "app_info",
        data: {
          device,
          bundleId,
          info,
        },
      });
    } catch {
      return formatResult("app_info", `App info found for ${bundleId}`, {
        ok: true,
        action: "app_info",
        data: {
          device,
          bundleId,
          raw: result.stdout.trim(),
        },
        warnings: ["simctl appinfo JSON parse failed. returned raw output."],
      });
    }
  }

  const fallback = await simctl.listApps(pi, device, signal);
  if (fallback.exitCode !== 0) {
    return formatResult("app_info", `Failed to read app info for ${bundleId}`, {
      ok: false,
      action: "app_info",
      errors: [
        err(
          result.stderr || result.stdout || fallback.stderr || fallback.stdout,
          "SIM_APP_INFO_FAILED",
        ),
      ],
    });
  }

  try {
    const apps = JSON.parse(fallback.stdout) as Record<string, unknown>;
    const info = apps[bundleId];
    if (!info) {
      return formatResult("app_info", `App not installed: ${bundleId}`, {
        ok: false,
        action: "app_info",
        errors: [
          err(
            `Bundle identifier '${bundleId}' is not installed on ${device}`,
            "SIM_APP_NOT_INSTALLED",
          ),
        ],
      });
    }

    return formatResult("app_info", `App info found for ${bundleId}`, {
      ok: true,
      action: "app_info",
      data: {
        device,
        bundleId,
        info,
      },
      warnings: ["used listapps fallback because appinfo command failed."],
    });
  } catch {
    return formatResult(
      "app_info",
      `Failed to parse app info for ${bundleId}`,
      {
        ok: false,
        action: "app_info",
        errors: [
          err(fallback.stderr || fallback.stdout, "SIM_APP_INFO_PARSE_FAILED"),
        ],
      },
    );
  }
}

async function readDefaults(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const device = simctl.resolveDeviceTarget(
    params.deviceId as string | undefined,
  );
  const domain = String(params.domain);
  const key = params.key ? String(params.key) : undefined;

  const spawnArgs = ["defaults", "read", domain];
  if (key) spawnArgs.push(key);

  const result = await simctl.spawn(pi, device, spawnArgs, signal);
  if (result.exitCode !== 0) {
    return formatResult("read_defaults", "Failed to read defaults", {
      ok: false,
      action: "read_defaults",
      errors: [err(result.stderr || result.stdout, "SIM_READ_DEFAULTS_FAILED")],
    });
  }

  return formatResult("read_defaults", "Defaults read", {
    ok: true,
    action: "read_defaults",
    data: {
      device,
      domain,
      key,
      value: result.stdout.trim(),
      raw: result.stdout,
    },
  });
}

async function writeDefaults(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
) {
  const device = simctl.resolveDeviceTarget(
    params.deviceId as string | undefined,
  );
  const domain = String(params.domain);
  const key = String(params.key);
  const value = String(params.value);

  const result = await simctl.spawn(
    pi,
    device,
    ["defaults", "write", domain, key, value],
    signal,
  );

  if (result.exitCode !== 0) {
    return formatResult("write_defaults", "Failed to write defaults", {
      ok: false,
      action: "write_defaults",
      errors: [
        err(result.stderr || result.stdout, "SIM_WRITE_DEFAULTS_FAILED"),
      ],
    });
  }

  return formatResult("write_defaults", "Defaults updated", {
    ok: true,
    action: "write_defaults",
    data: {
      device,
      domain,
      key,
      value,
    },
    warnings: ["restart app to ensure defaults changes are applied."],
  });
}

async function getAppContainerPath(
  pi: ExtensionAPI,
  params: ToolParams,
  signal?: AbortSignal,
): Promise<
  | {
      ok: true;
      device: string;
      bundleId: string;
      containerType: string;
      containerPath: string;
    }
  | {
      ok: false;
      error: string;
    }
> {
  const device = simctl.resolveDeviceTarget(
    params.deviceId as string | undefined,
  );
  const bundleId = String(params.bundleId);
  const containerType = String(params.containerType ?? "data");

  const result = await simctl.getAppContainer(
    pi,
    device,
    bundleId,
    containerType,
    signal,
  );

  if (result.exitCode !== 0) {
    return { ok: false, error: result.stderr || result.stdout };
  }

  return {
    ok: true,
    device,
    bundleId,
    containerType,
    containerPath: result.stdout.trim(),
  };
}

async function readContainerFile(params: ToolParams) {
  const path = String(params.path);
  try {
    const content = await readFile(path, "utf8");
    return formatResult("read_container_file", `Read ${path}`, {
      ok: true,
      action: "read_container_file",
      data: { path, content },
    });
  } catch (error) {
    return formatResult("read_container_file", "Failed to read file", {
      ok: false,
      action: "read_container_file",
      errors: [err(String(error), "SIM_READ_CONTAINER_FILE_FAILED")],
    });
  }
}

async function writeContainerFile(params: ToolParams) {
  const path = String(params.path);
  const content = String(params.content);
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
    return formatResult("write_container_file", `Wrote ${path}`, {
      ok: true,
      action: "write_container_file",
      data: { path },
    });
  } catch (error) {
    return formatResult("write_container_file", "Failed to write file", {
      ok: false,
      action: "write_container_file",
      errors: [err(String(error), "SIM_WRITE_CONTAINER_FILE_FAILED")],
    });
  }
}

function simpleSimctlResult(
  action: string,
  target: string,
  result: { stdout: string; stderr: string; exitCode: number },
) {
  const ok = result.exitCode === 0;
  return formatResult(
    action,
    ok ? `${action} ok: ${target}` : `${action} failed: ${target}`,
    {
      ok,
      action,
      data: {
        target,
        stdout: result.stdout,
        stderr: result.stderr,
      },
      errors: ok
        ? undefined
        : [err(result.stderr || result.stdout, "SIMCTL_FAILED")],
    },
  );
}
