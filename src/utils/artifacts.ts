import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(tmpdir(), "pi-xcode-artifacts");

export async function ensureArtifactsRoot(): Promise<string> {
  await mkdir(ROOT, { recursive: true });
  return ROOT;
}

export async function createArtifactRunDir(prefix: string): Promise<string> {
  await ensureArtifactsRoot();
  return mkdtemp(join(ROOT, `${prefix}-`));
}

export function artifactPath(dir: string, name: string): string {
  return join(dir, name);
}
