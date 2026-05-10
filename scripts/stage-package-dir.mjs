import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function isPathInside(rootPath, targetPath) {
  const relativePath = path.relative(rootPath, targetPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

export function readPackageManifest(repoRoot) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
}

function normalizeSurfaceEntry(entry) {
  return typeof entry === "string" ? entry.trim() : "";
}

export function resolvePackageSurfaceEntries(manifest) {
  const explicitEntries = Array.isArray(manifest.files)
    ? manifest.files.map(normalizeSurfaceEntry).filter(Boolean)
    : [];

  return ["package.json", ...explicitEntries.filter((e) => !e.startsWith("dist/"))];
}

function copySurfaceEntry(sourcePath, targetPath) {
  const sourceStats = fs.statSync(sourcePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  if (sourceStats.isDirectory()) {
    fs.cpSync(sourcePath, targetPath, { recursive: true, dereference: true });
    return;
  }

  fs.copyFileSync(sourcePath, targetPath);
}

function mergeCompiledOutput(repoRoot, outputDir) {
  const compileDir = path.join(repoRoot, "dist");
  if (!fs.existsSync(compileDir)) {
    return;
  }
  // Copy compiled JS files over their .ts counterparts in the staged package
  // to make compiled JS take precedence
  for (const entry of getAllFiles(compileDir)) {
    const src = path.join(compileDir, entry);
    const dst = path.join(outputDir, entry);
    if (fs.statSync(src).isDirectory()) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

function getAllFiles(dir, base = "") {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...getAllFiles(path.join(dir, entry.name), relPath));
    } else {
      files.push(relPath);
    }
  }
  return files;
}

export function stagePackageDir(params = {}) {
  const repoRoot = params.repoRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const outputDir = params.outputDir ?? path.join(repoRoot, "dist", "package");
  const manifest = params.manifest ?? readPackageManifest(repoRoot);
  const surfaceEntries = params.surfaceEntries ?? resolvePackageSurfaceEntries(manifest);

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  for (const entry of surfaceEntries) {
    const sourcePath = path.resolve(repoRoot, entry);
    if (!isPathInside(repoRoot, sourcePath)) {
      throw new Error(`Package surface entry escapes repository root: ${entry}`);
    }
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Package surface entry not found: ${entry}`);
    }
    if (isPathInside(sourcePath, outputDir)) {
      throw new Error(`Package surface entry overlaps build output: ${entry}`);
    }

    const targetPath = path.join(outputDir, entry);
    copySurfaceEntry(sourcePath, targetPath);
  }

  mergeCompiledOutput(repoRoot, outputDir);

  return outputDir;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.stdout.write(`${stagePackageDir()}\n`);
}