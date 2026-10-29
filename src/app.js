import { renderDocument } from "./document.js";
import {
  FONT_SIZES,
  applyFontSize,
  readFontSize,
  resolveInitialFontSize,
  stepFontSize,
  storeFontSize
} from "./font-size.js";
import { escapeHtml } from "./html.js";
import { MAX_DOCUMENT_LENGTH, clearDocument, readDocument, storeDocument } from "./session.js";
import {
  MAX_SHARE_URL_LENGTH,
  buildShareHash,
  buildShareUrl,
  decodeShare,
  encodeShare,
  parseShareHash
} from "./share.js";
import { SHORTCUTS, matchShortcut } from "./shortcuts.js";
import {
  DARK_QUERY,
  applyTheme,
  nextTheme,
  readStoredTheme,
  resolveInitialTheme,
  storeTheme
} from "./theme.js";
import { buildToc, decodeHash, findHeadingById } from "./toc.js";

const storage = window.localStorage;

const input = document.querySelector("#file-input");
const uploadButton = document.querySelector(".upload-button");
const preview = document.querySelector("#preview");
const uploadError = document.querySelector("#upload-error");
const status = document.querySelector("#status");
const themeToggle = document.querySelector("#theme-toggle");
const outline = document.querySelector("#outline");
const workspace = document.querySelector("#workspace");
const outlineList = document.querySelector("#outline-list");
const outlineToggle = document.querySelector("#toc-toggle");
const copyButton = document.querySelector("#copy-html");
const shareButton = document.querySelector("#share-link");
const printButton = document.querySelector("#print");
const clearButton = document.querySelector("#clear");
const editToggle = document.querySelector("#edit-toggle");
const editor = document.querySelector("#editor");
const textBigger = document.querySelector("#text-bigger");
const textSmaller = document.querySelector("#text-smaller");
const docActions = document.querySelector("#doc-actions");
const shortcutList = document.querySelector("#shortcut-list");
const placeholderHtml = preview.innerHTML;
// Capture only interface ids, before any document headings are rendered.
const reservedHeadingIds = Array.from(document.querySelectorAll("[id]"), (element) => element.id);
const SCROLL_OFFSET = 96;
const SMOOTH_SCROLL_MS = 800;

const examples = {
  "release-notes": `# Release Notes

## Highlights

- Added upload support
- Improved **Markdown** previews
- Kept unsafe HTML escaped

[Read more](https://example.com)`,
  "project-plan": `# Project Plan

1. Collect requirements
2. Build the first version
3. Review with the team

Next step: ship a focused preview.`,
  "technical-note": `# Technical Note

Use inline \`code\` for commands and fenced blocks for snippets.

\`\`\`js
const status = "ready";
\`\`\``,
  "frontmatter": `---
title: Release Notes
tags: [markdown, preview, local-first]
status: draft
reviewers:
  - Dana
  - Marco
---

# Release Notes

## Checklist

| Feature | State |
| :--- | :---: |
| Upload | done |
| Dark mode | done |

- [x] Parse YAML frontmatter
- [ ] Ship drag and drop

\`\`\`js
const theme = localStorage.getItem("md-viewer-theme") ?? "light";
\`\`\``
};

let markdown = "";
let documentName = "";
let headings = [];
let toc = [];
let activeId = "";
let outlineDismissed = false;
let editing = false;
let persistCurrentDocument = true;
// Payload of the shared document on screen; heading hashes keep it so scrolling
// or following the outline never drops the document from the link.
let sharePayload = "";

function headingFragment(id) {
  return buildShareHash(sharePayload, id);
}

function replaceHash(hash) {
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
}

function hashHeading(hash = window.location.hash) {
  return decodeHash(parseShareHash(hash).heading);
}

function setDocActionsVisible(hasDocument) {
  docActions.hidden = !hasDocument;
}

function showError(message) {
  uploadError.textContent = message;
  uploadError.hidden = false;
}

function clearError() {
  uploadError.textContent = "";
  uploadError.hidden = true;
}

function showStatus(message) {
  status.textContent = message;
  status.hidden = message === "";
}

function renderOutline() {
  outlineList.innerHTML = toc
    .map((heading) => `<li class="outline-item outline-depth-${heading.depth}"><a href="${escapeHtml(headingFragment(heading.id))}" data-heading="${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a></li>`)
    .join("");
  setOutlineVisible(!outlineDismissed);
  setActiveHeading(currentHashId());
}

function showMarkdown(nextMarkdown, name = "", options = {}) {
  markdown = String(nextMarkdown ?? "");
  documentName = String(name ?? "");
  if (!options.fromEditor) {
    editor.value = markdown;
    setEditing(false);
    persistCurrentDocument = options.persist !== false;
  }

  const result = renderDocument(markdown, { reservedIds: reservedHeadingIds });
  headings = result.headings;
  toc = buildToc(headings);

  preview.innerHTML = result.html;
  document.title = result.title ? `${result.title} · Markdown Viewer` : "Markdown Viewer";

  // Shared documents are never persisted, and must not touch the stored session.
  if (persistCurrentDocument) {
    if (markdown === "") {
      clearDocument(storage);
    } else if (!storeDocument(storage, markdown, documentName)) {
      showError(markdown.length > MAX_DOCUMENT_LENGTH
        ? `This document exceeds ${MAX_DOCUMENT_LENGTH.toLocaleString("en-US")} characters and was not saved. Keep a copy before reloading; the last saved document is unchanged.`
        : "This document was not saved because browser storage is unavailable. Keep a copy before reloading.");
    }
  }

  sharePayload = options.sharePayload ?? "";
  replaceHash(headingFragment(hashHeading()));

  setDocActionsVisible(true);

  renderOutline();
  if (!options.fromEditor) {
    scrollToHash(window.location.hash, { smooth: false });
    spyPausedUntil = 0;
    updateScrollSpy();
  }

  if (options.animate) {
    uploadButton.classList.remove("is-uploading");
    void uploadButton.offsetWidth;
    uploadButton.classList.add("is-uploading");
  }

  if (options.message) {
    showStatus(options.message);
  }
}

function resetDocument() {
  clearError();
  markdown = "";
  documentName = "";
  headings = [];
  toc = [];
  editor.value = "";
  setEditing(false);
  preview.innerHTML = placeholderHtml;
  document.title = "Markdown Viewer";
  clearDocument(storage);
  sharePayload = "";
  replaceHash("");
  setDocActionsVisible(false);
  renderOutline();
  showStatus("Cleared the stored document.");
}

function isMarkdownFile(file) {
  if (/\.(md|markdown|txt)$/i.test(file.name)) {
    return true;
  }
  return file.type === "text/markdown" || file.type === "text/plain";
}

async function loadFile(file) {
  clearError();
  if (!isMarkdownFile(file)) {
    showError("Choose a Markdown file (.md, .markdown or .txt).");
    return;
  }

  let content;
  try {
    content = await file.text();
  } catch {
    showError("The file could not be read.");
    return;
  }

  showMarkdown(content, file.name, { animate: true, message: `Loaded ${file.name}.` });
}

input.addEventListener("change", () => {
  const file = input.files?.[0];
  input.value = "";
  if (file) {
    loadFile(file);
  }
});

preview.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const button = event.target.closest("[data-example]");
  if (button instanceof HTMLButtonElement) {
    clearError();
    showMarkdown(examples[button.dataset.example], "", { message: "Loaded an example document." });
  }
});

let dragDepth = 0;

function isEditable(target) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(?:input|textarea|select)$/i.test(target.tagName));
}

document.addEventListener("dragenter", (event) => {
  if (!event.dataTransfer?.types.includes("Files") || isEditable(event.target)) {
    return;
  }
  dragDepth += 1;
  document.body.classList.add("is-dragging");
});

document.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types.includes("Files")) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }
});

document.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    document.body.classList.remove("is-dragging");
  }
});

document.addEventListener("drop", (event) => {
  if (!event.dataTransfer?.types.includes("Files")) {
    return;
  }
  event.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("is-dragging");
  const file = event.dataTransfer.files?.[0];
  if (file) {
    loadFile(file);
  }
});

document.addEventListener("paste", (event) => {
  if (isEditable(event.target)) {
    return;
  }

  const file = event.clipboardData?.files?.[0];
  if (file) {
    event.preventDefault();
    loadFile(file);
    return;
  }

  const text = event.clipboardData?.getData("text/plain");
  if (text?.trim()) {
    event.preventDefault();
    clearError();
    showMarkdown(text, "", { message: "Pasted Markdown from the clipboard." });
  }
});

function setOutlineVisible(visible) {
  const next = visible && toc.length > 0 && !editing;
  outline.hidden = !next;
  workspace.dataset.outline = next ? "visible" : "hidden";
  outlineToggle.setAttribute("aria-pressed", String(next));
  if (!next) {
    setActiveHeading("");
  }
  return next;
}

outlineToggle.addEventListener("click", () => {
  const next = !outline.hidden;
  outlineDismissed = next;
  setOutlineVisible(!next);
});

clearButton.addEventListener("click", resetDocument);

function setEditing(next) {
  editing = next;
  editor.hidden = !editing;
  preview.hidden = editing;
  editToggle.setAttribute("aria-pressed", String(editing));
  const label = editing ? "Show Markdown preview" : "Edit Markdown source";
  editToggle.setAttribute("aria-label", label);
  editToggle.title = label;
  setOutlineVisible(!outlineDismissed);
}

editToggle.addEventListener("click", () => {
  setEditing(!editing);
  if (editing) {
    editor.focus();
  } else {
    updateScrollSpy();
  }
});

editor.addEventListener("input", () => {
  clearError();
  showMarkdown(editor.value, documentName, { fromEditor: true });
  showStatus("");
});

outlineList.addEventListener("click", (event) => {
  const link = event.target instanceof Element ? event.target.closest("a[data-heading]") : null;
  if (!(link instanceof HTMLAnchorElement)) {
    return;
  }

  event.preventDefault();
  const heading = toc.find((item) => item.id === link.dataset.heading);
  if (!heading) {
    return;
  }

  replaceHash(headingFragment(heading.id));
  setActiveHeading(heading.id);
  scrollToHeading(heading.id, { smooth: true });
});

function currentHashId() {
  const heading = findHeadingById(headings, hashHeading());
  return heading?.id ?? "";
}

function scrollToHeading(id, options = {}) {
  const target = document.getElementById(id);
  if (!target) {
    return false;
  }
  if (options.smooth) {
    spyPausedUntil = performance.now() + SMOOTH_SCROLL_MS;
  }
  target.scrollIntoView({ behavior: options.smooth ? "smooth" : "instant", block: "start" });
  return true;
}

function scrollToHash(hash, options = {}) {
  const heading = findHeadingById(headings, hashHeading(hash));
  if (!heading) {
    return false;
  }
  setOutlineVisible(true);
  setActiveHeading(heading.id);
  return scrollToHeading(heading.id, options);
}

function setActiveHeading(id) {
  activeId = id;
  for (const link of outlineList.querySelectorAll("a[data-heading]")) {
    const isActive = link.dataset.heading === id && id !== "";
    link.classList.toggle("is-active", isActive);
    if (isActive) {
      link.setAttribute("aria-current", "true");
    } else {
      link.removeAttribute("aria-current");
    }
  }
}

let spyPending = false;
let spyPausedUntil = 0;

function updateScrollSpy() {
  if (outline.hidden || toc.length === 0) {
    return;
  }
  if (performance.now() < spyPausedUntil) {
    return;
  }

  const offset = SCROLL_OFFSET;
  let current = toc[0].id;
  for (const heading of toc) {
    const element = document.getElementById(heading.id);
    // Scroll positions can round to a pixel while heading bounds remain fractional.
    if (element && element.getBoundingClientRect().top - offset <= 1) {
      current = heading.id;
    }
  }

  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
    current = toc[toc.length - 1].id;
  }

  if (current !== activeId) {
    replaceHash(headingFragment(current));
    setActiveHeading(current);
  }
}

window.addEventListener("scroll", () => {
  if (spyPending) {
    return;
  }
  spyPending = true;
  requestAnimationFrame(() => {
    spyPending = false;
    updateScrollSpy();
  });
}, { passive: true });

window.addEventListener("hashchange", async () => {
  // A share link pasted over the current page only changes the hash.
  const { payload } = parseShareHash(window.location.hash);
  if (payload !== null && payload !== sharePayload) {
    await loadSharedDocument(payload);
    return;
  }
  scrollToHash(window.location.hash, { smooth: true });
});

async function copyHtml() {
  const html = preview.innerHTML.trim();
  if (html === "") {
    showStatus("There is nothing to copy yet.");
    return;
  }

  try {
    await navigator.clipboard.writeText(html);
    showStatus("Copied the rendered HTML.");
  } catch {
    showStatus("The clipboard is not available in this browser.");
  }
}

copyButton.addEventListener("click", copyHtml);

async function copyShareLink() {
  if (markdown === "") {
    showStatus("There is nothing to share yet.");
    return;
  }

  const source = markdown;
  const name = documentName;
  let payload;
  try {
    payload = await encodeShare(source, name);
  } catch (error) {
    showStatus(error instanceof RangeError
      ? "This document is too large for a link. Share the file instead."
      : "The document could not be encoded.");
    return;
  }

  if (source !== markdown || name !== documentName) {
    showStatus("The document changed. Copy a new share link.");
    return;
  }

  const url = buildShareUrl(window.location, payload, hashHeading());
  if (url.length > MAX_SHARE_URL_LENGTH) {
    showStatus(`This document is too large for a link (${url.length} characters). Share the file instead.`);
    return;
  }

  sharePayload = payload;
  replaceHash(headingFragment(hashHeading()));
  try {
    await navigator.clipboard.writeText(url);
    showStatus("Copied a shareable link to the clipboard.");
  } catch {
    showStatus("The shareable link is ready in the address bar.");
  }
}

shareButton.addEventListener("click", copyShareLink);

printButton.addEventListener("click", () => window.print());

let fontSize = resolveInitialFontSize(readFontSize(storage));

function syncFontSize() {
  applyFontSize(fontSize, document.documentElement);
  const index = FONT_SIZES.indexOf(fontSize);
  textSmaller.disabled = index === 0;
  textBigger.disabled = index === FONT_SIZES.length - 1;
}

function changeFontSize(direction) {
  fontSize = stepFontSize(fontSize, direction);
  syncFontSize();
  storeFontSize(storage, fontSize);
}

textSmaller.addEventListener("click", () => changeFontSize("smaller"));
textBigger.addEventListener("click", () => changeFontSize("bigger"));

const colorScheme = window.matchMedia?.(DARK_QUERY);
let theme = resolveInitialTheme(readStoredTheme(storage), Boolean(colorScheme?.matches));
applyTheme(theme, document.documentElement);

function syncTheme(next) {
  theme = next;
  applyTheme(theme, document.documentElement);
  const label = `Switch to ${theme === "dark" ? "light" : "dark"} mode`;
  themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
  themeToggle.setAttribute("aria-label", label);
  themeToggle.title = label;
}

themeToggle.addEventListener("click", () => {
  syncTheme(nextTheme(theme));
  storeTheme(storage, theme);
});

colorScheme?.addEventListener("change", (event) => {
  if (readStoredTheme(storage)) {
    return;
  }
  syncTheme(resolveInitialTheme(null, event.matches));
});

document.addEventListener("keydown", (event) => {
  const action = matchShortcut(event);
  if (!action) {
    return;
  }

  switch (action) {
    case "toggle-theme":
      syncTheme(nextTheme(theme));
      storeTheme(storage, theme);
      break;
    case "toggle-toc":
      outlineDismissed = !outline.hidden;
      setOutlineVisible(outline.hidden);
      break;
    case "bigger-text":
      changeFontSize("bigger");
      break;
    case "smaller-text":
      changeFontSize("smaller");
      break;
    case "copy-html":
      copyHtml();
      break;
    case "share-link":
      copyShareLink();
      break;
    case "print":
      window.print();
      break;
    case "close-toc":
      outlineDismissed = true;
      setOutlineVisible(false);
      break;
    default:
      return;
  }

  event.preventDefault();
});

syncTheme(theme);
syncFontSize();
renderShortcuts();
start();

function renderShortcuts() {
  if (shortcutList.children.length > 0) {
    return;
  }
  shortcutList.innerHTML = SHORTCUTS
    .map((shortcut) => `<div class="shortcut"><dt>${escapeHtml(shortcut.keys.join(" / "))}</dt><dd>${escapeHtml(shortcut.label)}</dd></div>`)
    .join("");
}

function restoreSession() {
  const stored = readDocument(storage);
  if (!stored) {
    return;
  }

  showMarkdown(stored.markdown, stored.name);
}

async function start() {
  const { payload } = parseShareHash(window.location.hash);
  if (payload !== null && await loadSharedDocument(payload)) {
    return;
  }
  restoreSession();
}

async function loadSharedDocument(payload) {
  const shared = await decodeShare(payload);
  if (!shared) {
    replaceHash(headingFragment(hashHeading()));
    showError("The shared link is not valid.");
    return false;
  }

  clearError();
  showMarkdown(shared.markdown, shared.name, {
    sharePayload: payload,
    persist: false,
    message: "Loaded a shared document from the link."
  });
  return true;
}
