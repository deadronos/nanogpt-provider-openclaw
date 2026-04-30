import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type PackageManifest = {
  dependencies?: unknown;
  files?: unknown;
  openclaw?: {
    build?: {
      openclawVersion?: unknown;
      pluginSdkVersion?: unknown;
    };
    compat?: {
      minGatewayVersion?: unknown;
      pluginApi?: unknown;
    };
  };
  peerDependencies?: unknown;
};

const repoRoot = dirname(fileURLToPath(import.meta.url));
const TARGET_OPENCLAW_VERSION = "2026.4.22";

function readPackageManifest(): PackageManifest {
  return JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as PackageManifest;
}

function readPluginManifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(repoRoot, "openclaw.plugin.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function resolveFileEntries(manifest: PackageManifest): string[] {
  if (!Array.isArray(manifest.files)) {
    return [];
  }

  return manifest.files.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
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
        "provider/bridge/types.ts",
        "provider/bridge/system-prompt.ts",
        "provider/bridge/object-parser.ts",
        "provider/bridge/xml-parser.ts",
        "provider/bridge/retry.ts",
        "provider/bridge/keepalive.ts",
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

  it("targets the current provider SDK generation explicitly", () => {
    const manifest = readPackageManifest();
    const peerDependencies = readRecord(manifest.peerDependencies);

    expect(peerDependencies.openclaw).toBe(`>=${TARGET_OPENCLAW_VERSION}`);
    expect(manifest.openclaw?.compat?.pluginApi).toBe(`>=${TARGET_OPENCLAW_VERSION}`);
    expect(manifest.openclaw?.compat?.minGatewayVersion).toBe(TARGET_OPENCLAW_VERSION);
    expect(manifest.openclaw?.build?.openclawVersion).toBe(TARGET_OPENCLAW_VERSION);
    expect(manifest.openclaw?.build?.pluginSdkVersion).toBe(TARGET_OPENCLAW_VERSION);
  });

  it("declares runtime capability ownership through manifest contracts", () => {
    const manifest = readPluginManifest();
    const contracts = readRecord(manifest.contracts);

    expect(contracts.imageGenerationProviders).toEqual(["nanogpt"]);
    expect(contracts.webSearchProviders).toEqual(["nanogpt"]);
  });

  it("mirrors NanoGPT auth env metadata into setup providers", () => {
    const manifest = readPluginManifest();
    const setup = readRecord(manifest.setup);
    const providers = Array.isArray(setup.providers) ? setup.providers : [];

    expect(providers).toEqual([
      expect.objectContaining({
        id: "nanogpt",
        envVars: ["NANOGPT_API_KEY"],
      }),
    ]);
  });

  it("keeps documented plugin config fields in the manifest schema", () => {
    const manifest = readPluginManifest();
    const configSchema = readRecord(manifest.configSchema);
    const properties = readRecord(configSchema.properties);

    expect(properties.responseFormat).toMatchObject({
      anyOf: expect.arrayContaining([
        { const: false },
        {
          type: "string",
          enum: ["json_object"],
        },
      ]),
    });
  });

  it("does not ship unused Telegram runtime dependencies", () => {
    const manifest = readPackageManifest();
    const dependencies = readRecord(manifest.dependencies);

    expect(dependencies.grammy).toBeUndefined();
  });
});
