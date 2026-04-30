import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error Test imports a plain .mjs build script under a TS-only repo config.
import { resolvePackageSurfaceEntries, stagePackageDir } from "./scripts/stage-package-dir.mjs";

const tempPaths: string[] = [];

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nanogpt-stage-package-dir-"));
  tempPaths.push(tempDir);
  return tempDir;
}

afterEach(() => {
  while (tempPaths.length > 0) {
    const tempPath = tempPaths.pop();
    if (!tempPath) {
      continue;
    }
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

describe("stage package dir", () => {
  it("includes package.json plus every declared package surface entry", () => {
    expect(
      resolvePackageSurfaceEntries({
        files: ["index.ts", "README.md", "nested/config.json"],
      }),
    ).toEqual(["package.json", "index.ts", "README.md", "nested/config.json"]);
  });

  it("stages a clean install directory from the declared package surface", () => {
    const repoRoot = makeTempDir();
    const outputDir = path.join(repoRoot, "dist", "package");
    const manifest = {
      name: "example-plugin",
      version: "1.0.0",
      files: ["index.ts", "README.md", "nested/config.json"],
    };

    fs.writeFileSync(path.join(repoRoot, "package.json"), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(repoRoot, "index.ts"), "export const plugin = true;\n");
    fs.writeFileSync(path.join(repoRoot, "README.md"), "# Example\n");
    fs.mkdirSync(path.join(repoRoot, "nested"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "nested", "config.json"), '{"ok":true}\n');

    const stagedDir = stagePackageDir({ repoRoot, outputDir });

    expect(stagedDir).toBe(outputDir);
    expect(fs.readFileSync(path.join(outputDir, "package.json"), "utf8")).toContain(
      '"example-plugin"',
    );
    expect(fs.readFileSync(path.join(outputDir, "index.ts"), "utf8")).toContain("plugin = true");
    expect(fs.readFileSync(path.join(outputDir, "README.md"), "utf8")).toContain("# Example");
    expect(fs.readFileSync(path.join(outputDir, "nested", "config.json"), "utf8")).toContain(
      '"ok":true',
    );
    expect(fs.existsSync(path.join(outputDir, "node_modules"))).toBe(false);
  });
});
