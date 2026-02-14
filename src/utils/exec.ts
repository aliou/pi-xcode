import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run a shell command and return structured output.
 */
export interface RunOptions {
  signal?: AbortSignal;
  cwd?: string;
}

export async function run(
  pi: ExtensionAPI,
  command: string[],
  signalOrOptions?: AbortSignal | RunOptions,
): Promise<RunResult> {
  const [cmd, ...args] = command;
  const options: RunOptions =
    signalOrOptions instanceof AbortSignal
      ? { signal: signalOrOptions }
      : (signalOrOptions ?? {});

  const result = await pi.exec(cmd, args, {
    signal: options.signal,
    cwd: options.cwd,
  });

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.code ?? 1,
  };
}
