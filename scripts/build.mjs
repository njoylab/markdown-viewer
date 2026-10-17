import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const outDir = join(root, "dist");
const sourceDir = join(root, "src");
const hashedNames = new Map();

await rm(outDir, { recursive: true, force: true });
await mkdir(join(outDir, "src"), { recursive: true });

const modules = await listFiles(sourceDir);
const sources = new Map();

for (const file of modules) {
  const name = file.slice(sourceDir.length + 1);
  sources.set(name, await readFile(file, "utf8"));
}

const digests = new Map();

function digestOf(name, stack = []) {
  if (digests.has(name)) {
    return digests.get(name);
  }
  if (stack.includes(name)) {
    throw new Error(`Circular import detected: ${[...stack, name].join(" -> ")}`);
  }

  const imports = [...sources.get(name).matchAll(/(?:from\s*")(\.\/[^"]+)(")/g)].map((match) => match[1].slice(2));
  const hash = createHash("sha256");
  hash.update(sources.get(name));
  for (const specifier of imports.sort()) {
    if (!sources.has(specifier)) {
      throw new Error(`Unresolved import "${specifier}" in ${name}`);
    }
    hash.update(`\n${specifier}:${digestOf(specifier, [...stack, name])}`);
  }

  const value = hash.digest("hex").slice(0, 12);
  digests.set(name, value);
  return value;
}

for (const name of sources.keys()) {
  digestOf(name);
  const extension = name.slice(name.lastIndexOf("."));
  const base = name.slice(0, name.length - extension.length);
  hashedNames.set(name, `${base}.${digests.get(name)}${extension}`);
}

for (const file of modules) {
  const name = file.slice(sourceDir.length + 1);
  const source = await readFile(file, "utf8");
  const rewritten = source.replaceAll(/(from\s*")(\.\/[^"]+)(")/g, (match, before, specifier, after) => {
    const target = hashedNames.get(specifier.slice(2));
    if (!target) {
      throw new Error(`Unresolved import "${specifier}" in ${name}`);
    }
    return `${before}./${target}${after}`;
  });
  await writeFile(join(outDir, "src", hashedNames.get(name)), rewritten);
}

const html = (await readFile(join(root, "index.html"), "utf8")).replaceAll(
  /(\.\/src\/)([\w.-]+?\.(?:js|css))\?v=__ASSET_VERSION__/g,
  (match, prefix, file) => {
    const hashed = hashedNames.get(file);
    if (!hashed) {
      throw new Error(`Unresolved asset "${file}" in index.html`);
    }
    return `${prefix}${hashed}`;
  }
);

if (/__ASSET_VERSION__/.test(html)) {
  throw new Error("Unresolved __ASSET_VERSION__ placeholder in index.html");
}

await writeFile(join(outDir, "index.html"), html);
await writeFile(
  join(outDir, "_headers"),
  [
    "/index.html",
    "  Cache-Control: public, max-age=0, must-revalidate",
    "",
    "/robots.txt",
    "  Cache-Control: public, max-age=3600",
    "",
    "/src/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    ""
  ].join("\n")
);
await cp(join(root, ".nojekyll"), join(outDir, ".nojekyll"));
await cp(join(root, "robots.txt"), join(outDir, "robots.txt"));

console.log(`Built ${modules.length} modules into dist/`);

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}