import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { contentType } from "../../scripts/content-type.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../..");
const samplePath = join(repoRoot, "test/fixtures/sample.md");
const appUrl = "http://markdown-viewer.test/";

test("restores the last document after a reload", { timeout: 20000 }, async () => {
  const { browser, page } = await openPage();
  try {
    await paste(page, "# Stored doc\n\nKept between visits.");

    await page.reload();

    await page.waitForSelector("#preview h1#stored-doc");
    assert.equal(await page.locator("#preview p").last().textContent(), "Kept between visits.");
    assert.match(await page.locator("#status").textContent(), /Restored your last document/);
  } finally {
    await browser.close();
  }
});

test("restores the uploaded file name", { timeout: 20000 }, async () => {
  const { browser, page } = await openPage();
  try {
    await page.locator("#file-input").setInputFiles(samplePath);
    await page.waitForSelector("#preview");

    await page.reload();

    await page.waitForSelector("#preview");
    assert.match(await page.locator("#status").textContent(), /Restored sample\.md from your last session/);
    assert.equal(await page.evaluate(() => localStorage.getItem("md-viewer-document-name")), "sample.md");
  } finally {
    await browser.close();
  }
});

test("uses the document title for the page title", { timeout: 20000 }, async () => {
  const { browser, page } = await openPage();
  try {
    await paste(page, "# Release Notes\n\nBody.");

    assert.equal(await page.title(), "Release Notes · Markdown Viewer");
  } finally {
    await browser.close();
  }
});

test("clears the stored document and the hash", { timeout: 20000 }, async () => {
  const { browser, page } = await openPage();
  try {
    const filler = Array.from({ length: 60 }, (_, index) => `Filler line ${index}.`).join("\n\n");
    await paste(page, `# Stored doc\n\n## Section\n\n${filler}`);
    await page.locator('.outline-item a[data-heading="section"]').click();
    await page.waitForFunction(() => document.getElementById("section").getBoundingClientRect().top < 120);

    await page.locator("#clear").click();

    assert.equal(await page.evaluate(() => location.hash), "");
    assert.equal(await page.locator("#outline").isVisible(), false);
    assert.match(await page.locator("#preview h2").first().textContent(), /Ready to preview Markdown/);

    await page.reload();

    assert.equal(await page.locator("#outline").isVisible(), false);
    assert.match(await page.locator("#preview h2").first().textContent(), /Ready to preview Markdown/);
  } finally {
    await browser.close();
  }
});

test("shows the document actions only while a document is loaded", { timeout: 20000 }, async () => {
  const { browser, page } = await openPage();
  try {
    assert.equal(await page.locator("#doc-actions").isVisible(), false);

    await paste(page, "# Loaded\n\nBody.");

    assert.equal(await page.locator("#doc-actions").isVisible(), true);

    await page.locator("#clear").click();

    assert.equal(await page.locator("#doc-actions").isVisible(), false);
  } finally {
    await browser.close();
  }
});

test("changes and remembers the text size", { timeout: 20000 }, async () => {
  const { browser, page } = await openPage();
  try {
    assert.equal(await page.evaluate(() => document.documentElement.dataset.fontSize), "medium");
    await paste(page, "# Loaded\n\nBody.");

    await page.locator("#text-bigger").click();

    assert.equal(await page.evaluate(() => document.documentElement.dataset.fontSize), "large");
    assert.equal(await page.evaluate(() => localStorage.getItem("md-viewer-font-size")), "large");

    await page.reload();

    assert.equal(await page.evaluate(() => document.documentElement.dataset.fontSize), "large");

    await page.locator("#text-smaller").click();
    await page.locator("#text-smaller").click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.fontSize), "small");
    assert.equal(await page.locator("#text-smaller").isDisabled(), true);
  } finally {
    await browser.close();
  }
});

test("toggles the theme with the keyboard", { timeout: 20000 }, async () => {
  const { browser, page } = await openPage();
  try {
    await page.locator("#preview").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("t");

    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
    assert.equal(await page.evaluate(() => localStorage.getItem("md-viewer-theme")), "dark");

    await page.keyboard.press("t");
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  } finally {
    await browser.close();
  }
});

test("changes the text size with the keyboard", { timeout: 20000 }, async () => {
  const { browser, page } = await openPage();
  try {
    await page.locator("#preview").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("+");
    assert.equal(await page.evaluate(() => document.documentElement.dataset.fontSize), "large");

    await page.keyboard.press("-");
    await page.keyboard.press("-");
    assert.equal(await page.evaluate(() => document.documentElement.dataset.fontSize), "small");
  } finally {
    await browser.close();
  }
});

test("ignores shortcuts typed inside the file input", { timeout: 20000 }, async () => {
  const { browser, page } = await openPage();
  try {
    await page.locator("#file-input").focus();
    await page.keyboard.press("t");

    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  } finally {
    await browser.close();
  }
});

test("lists the keyboard shortcuts in the help panel", { timeout: 20000 }, async () => {
  const { browser, page } = await openPage();
  try {
    await page.locator("#shortcuts summary").click();

    const shortcuts = await page.locator(".shortcut").allTextContents();

    assert.ok(shortcuts.some((text) => text.includes("Toggle dark mode")));
    assert.ok(shortcuts.some((text) => text.includes("Increase text size")));
    assert.ok(shortcuts.some((text) => text.includes("Copy a shareable link")));
    assert.equal(shortcuts.length, 8);
  } finally {
    await browser.close();
  }
});

test("keeps links to blocked schemes as plain text", { timeout: 20000 }, async () => {
  const { browser, page } = await openPage();
  try {
    await paste(page, "[run](javascript:alert(1)) and [ok](https://example.com)");

    assert.equal(await page.locator("#preview a").count(), 1);
    assert.equal(await page.locator("#preview a").getAttribute("href"), "https://example.com");
    assert.equal(await page.locator("#preview a").getAttribute("rel"), "noreferrer noopener");
    assert.equal(
      await page.locator("#preview p").textContent(),
      "[run](javascript:alert(1)) and ok"
    );
  } finally {
    await browser.close();
  }
});

async function openPage() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await routeStaticFiles(page);
  await page.goto(appUrl);
  return { browser, page };
}

async function paste(page, text) {
  await page.evaluate((value) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/plain", value);
    document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dataTransfer, bubbles: true, cancelable: true }));
  }, text);
}

async function routeStaticFiles(page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = resolve(repoRoot, `.${pathname}`);
    const escaped = relative(repoRoot, filePath);
    if (escaped === ".." || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) {
      await route.fulfill({ status: 403, body: "Forbidden" });
      return;
    }

    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        throw new Error("Not a file");
      }
      await route.fulfill({
        status: 200,
        contentType: contentType(filePath),
        body: await readFile(filePath)
      });
    } catch {
      await route.fulfill({ status: 404, body: "Not found" });
    }
  });
}