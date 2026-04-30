import fs from "node:fs";
import { readFileSync } from "node:fs";
import os from "node:os";
import path, { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error Test imports a plain .mjs build script under a TS-only repo config.
import { stagePackageDir } from "./scripts/stage-package-dir.mjs";

type PackageManifest = {
  name?: string;
  version?: string;
  openclaw?: {
    extensions?: unknown;
  };
};

type InstallSecurityScanResult = {
  blocked?: {
    code?: "security_scan_blocked" | "security_scan_failed";
    reason: string;
  };
};

type ScanPackageInstallSourceRuntime = (params: {
  extensions: string[];
  logger: {
    warn?: (message: string) => void;
  };
  packageDir: string;
  pluginId: string;
  requestKind?: "skill-install" | "plugin-dir" | "plugin-archive" | "plugin-file" | "plugin-npm";
  requestedSpecifier?: string;
  mode?: "install" | "update";
  packageName?: string;
  manifestId?: string;
  version?: string;
  dangerouslyForceUnsafeInstall?: boolean;
}) => Promise<InstallSecurityScanResult | undefined>;

const repoRoot = dirname(fileURLToPath(import.meta.url));
const tempPaths: string[] = [];

afterEach(() => {
  while (tempPaths.length > 0) {
    const tempPath = tempPaths.pop();
    if (!tempPath) {
      continue;
    }
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nanogpt-install-preflight-"));
  tempPaths.push(tempDir);
  return tempDir;
}

async function loadScanPackageInstallSourceRuntime(): Promise<ScanPackageInstallSourceRuntime> {
  const runtimeModulePath = "./node_modules/openclaw/dist/install-security-scan.runtime.js";
  const runtimeModule = (await import(runtimeModulePath)) as {
    scanPackageInstallSourceRuntime: ScanPackageInstallSourceRuntime;
  };

  return runtimeModule.scanPackageInstallSourceRuntime;
}

function readPackageManifest(): PackageManifest {
  return JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as PackageManifest;
}

function resolveExtensionEntries(manifest: PackageManifest): string[] {
  const entries = manifest.openclaw?.extensions;
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
}

describe("plugin install preflight", () => {
  it("does not trigger OpenClaw install warnings when scanning the staged package surface", async () => {
    const manifest = readPackageManifest();
    const extensions = resolveExtensionEntries(manifest);
    const warnings: string[] = [];
    const scanPackageInstallSourceRuntime = await loadScanPackageInstallSourceRuntime();
    const stagedPackageDir = path.join(makeTempDir(), "package");

    stagePackageDir({ outputDir: stagedPackageDir });

    expect(extensions.length).toBeGreaterThan(0);

    const result = await scanPackageInstallSourceRuntime({
      extensions,
      logger: {
        warn: (message: string) => warnings.push(message),
      },
      manifestId: "nanogpt",
      mode: "install",
      packageDir: stagedPackageDir,
      packageName: manifest.name,
      pluginId: "nanogpt",
      requestKind: "plugin-dir",
      requestedSpecifier: stagedPackageDir,
      version: manifest.version,
    });

    expect(result).toBeUndefined();
    expect(warnings).toEqual([]);
  });
});
