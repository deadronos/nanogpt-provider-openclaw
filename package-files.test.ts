import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type PackageManifest = {
  files?: unknown;
};

const repoRoot = dirname(fileURLToPath(import.meta.url));

function readPackageManifest(): PackageManifest {
  return JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as PackageManifest;
}

function resolveFileEntries(manifest: PackageManifest): string[] {
  if (!Array.isArray(manifest.files)) {
    return [];
  }

  return manifest.files.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

describe("package manifest files", () => {
  it("keeps every runtime entrypoint in the published package surface", () => {
    const manifest = readPackageManifest();
    const files = resolveFileEntries(manifest);

    expect(files).toEqual(
      expect.arrayContaining([
        "index.ts",
        "api.ts",
        "models.ts",
        "runtime.ts",
        "runtime/config.ts",
        "runtime/dynamic-models.ts",
        "runtime/discovery.ts",
        "runtime/provider-pricing.ts",
        "runtime/routing.ts",
        "runtime/usage.ts",
        "catalog/models-json-snapshot.ts",
        "catalog/build-provider.ts",
        "provider/anomaly-types.ts",
        "provider/anomaly-logger.ts",
        "provider/replay-hooks.ts",
        "provider/tool-schema-hooks.ts",
        "provider/error-hooks.ts",
        "provider/stream-hooks.ts",
        "provider-catalog.ts",
        "provider-discovery.ts",
        "web-search/credentials.ts",
        "web-search/results.ts",
        "image/request.ts",
        "image/response.ts",
        "image-generation-provider.ts",
        "web-search.ts",
        "onboard.ts",
        "openclaw.plugin.json",
        "README.md",
        "LICENSE.md",
      ]),
    );
  });
});
