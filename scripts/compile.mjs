#!/usr/bin/env node
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "dist");

// Clean dist directory before compilation
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));

// Collect all .ts entry points from the files list
const entryPoints = new Set();
for (const file of packageJson.files) {
  if (file.endsWith(".ts") && !file.includes("/")) {
    entryPoints.add(path.join(repoRoot, file));
  }
  // Also check subdirectory .ts files
  if (file.includes(".ts")) {
    const fullPath = path.join(repoRoot, file);
    if (fs.existsSync(fullPath) && !entryPoints.has(fullPath)) {
      // Only add if it's a direct entry point (not a依赖)
    }
  }
}

// Actually, let's just compile all .ts files in the root and subdirectories
// that are part of the package surface
function findTsEntries(dir, base = "") {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
    const relPath = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      findTsEntries(path.join(dir, entry.name), relPath);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      entryPoints.add(path.join(dir, entry.name));
    }
  }
}

findTsEntries(repoRoot);

const entryArray = [...entryPoints].filter((p) => !p.endsWith(".test.ts"));

await esbuild.build({
  entryPoints: entryArray,
  outdir: outDir,
  platform: "node",
  target: "node18",
  format: "esm",
  bundle: false,
  splitting: false,
  sourcemap: false,
  minify: false,
});

console.log(`Compiled ${entryArray.length} entry points to ${outDir}`);