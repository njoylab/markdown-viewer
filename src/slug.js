const MARKDOWN_INLINE = /`([^`]*)`|!?\[([^\]]*)\]\([^)]*\)|[*_~]|<[^>]*>/g;
const SEPARATORS = /[\s\u00a0]+/g;
const UNSAFE = /[^\p{Letter}\p{Number}\- ]/gu;

export function plainText(value) {
  return String(value ?? "")
    .replace(MARKDOWN_INLINE, (match, code, label) => code ?? label ?? "")
    .replace(/\\([\\`*_{}[\]()#+\-.!>])/g, "$1")
    .trim();
}

export function slugify(value) {
  const text = plainText(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(SEPARATORS, "-")
    .replace(UNSAFE, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  return text || "section";
}

export function createSlugger(reservedIds = []) {
  const used = new Set(reservedIds);
  const suffixes = new Map();

  return function slug(text) {
    const base = slugify(text);
    let suffix = suffixes.get(base) ?? 0;
    let id = suffix === 0 ? base : `${base}-${suffix}`;
    while (used.has(id)) {
      suffix += 1;
      id = `${base}-${suffix}`;
    }
    used.add(id);
    suffixes.set(base, suffix + 1);
    return id;
  };
}
