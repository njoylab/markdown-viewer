export const SHORTCUTS = [
  { action: "toggle-theme", keys: ["T"], label: "Toggle dark mode" },
  { action: "toggle-toc", keys: ["O"], label: "Show or hide the outline" },
  { action: "bigger-text", keys: ["+", "="], label: "Increase text size" },
  { action: "smaller-text", keys: ["-"], label: "Decrease text size" },
  { action: "copy-html", keys: ["C"], label: "Copy the rendered HTML" },
  { action: "share-link", keys: ["S"], label: "Copy a shareable link" },
  { action: "print", keys: ["P"], label: "Print or save as PDF" },
  { action: "close-toc", keys: ["Esc"], label: "Close the outline" }
];

const KEYS = new Map(
  SHORTCUTS.flatMap((shortcut) => shortcut.keys.map((key) => [normalizeKey(key), shortcut.action]))
);

export function matchShortcut(event) {
  if (!event || typeof event.key !== "string") {
    return null;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return null;
  }
  if (event.key !== "Escape" && isEditable(event.target)) {
    return null;
  }
  const action = KEYS.get(normalizeKey(event.key));
  return action ?? null;
}

export function isEditable(target) {
  return Boolean(
    target &&
      typeof target === "object" &&
      (target.isContentEditable === true || /^(?:input|textarea|select)$/i.test(target.tagName ?? ""))
  );
}

function normalizeKey(key) {
  if (key === "Esc") {
    return "Escape";
  }
  return key.length === 1 ? key.toLowerCase() : key;
}