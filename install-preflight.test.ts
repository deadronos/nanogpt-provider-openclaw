import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
  it("does not trigger OpenClaw install warnings when scanning the repository checkout", async () => {
    const manifest = readPackageManifest();
    const extensions = resolveExtensionEntries(manifest);
    const warnings: string[] = [];
    const scanPackageInstallSourceRuntime = await loadScanPackageInstallSourceRuntime();

    expect(extensions.length).toBeGreaterThan(0);

    const result = await scanPackageInstallSourceRuntime({
      extensions,
      logger: {
        warn: (message: string) => warnings.push(message),
      },
      manifestId: "nanogpt",
      mode: "install",
      packageDir: repoRoot,
      packageName: manifest.name,
      pluginId: "nanogpt",
      requestKind: "plugin-dir",
      requestedSpecifier: repoRoot,
      version: manifest.version,
    });

    expect(result).toBeUndefined();
    expect(warnings).toEqual([]);
  });
});