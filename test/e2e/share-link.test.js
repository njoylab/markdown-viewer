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

test("copies a share link that restores the document without local storage", { timeout: 20000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://markdown-viewer.test" });
  const page = await context.newPage();
  await routeStaticFiles(page);
  try {
    await page.goto(appUrl);
    await page.locator("#file-input").setInputFiles(samplePath);
    await page.locator("#preview").getByText("Release Notes").first().waitFor();

    await page.locator("#share-link").click();

    // Copying is async (encode + clipboard), so wait for the status it sets.
    await page.locator("#status", { hasText: /shareable link/i }).waitFor();
    await assertVisibleText(page, "Release Notes");

    const hash = await page.evaluate(() => window.location.hash);
    assert.match(hash, /^#d=z[\w-]+(&h=[\w%-]+)?$/);
    assert.equal(await page.evaluate(() => window.location.search), "");

    const stored = await page.evaluate(() => localStorage.getItem("md-viewer-document"));
    assert.match(stored, /Release Notes/);

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const requested = [];
    visitor.on("request", (request) => requested.push(request.url()));
    await routeStaticFiles(visitor);
    await visitor.goto(`${appUrl}${hash}`);

    await assertVisibleText(visitor, "Release Notes");
    await assertVisibleText(visitor, "Expected Result");
    assert.match(await visitor.locator("#status").textContent(), /Loaded a shared document/);
    assert.equal(await visitor.evaluate(() => localStorage.getItem("md-viewer-document")), null);
    assert.ok(requested.length > 0);
    assert.ok(requested.every((url) => !url.includes("#") && !url.includes("d=z")), requested.join("\n"));

    await visitor.locator("#outline-list a").last().click();
    const visitorHash = await visitor.evaluate(() => window.location.hash);
    assert.ok(visitorHash.startsWith(hash.split("&")[0]), visitorHash);
    assert.match(visitorHash, /&h=[\w%-]+$/);

    await visitor.reload();
    await assertVisibleText(visitor, "Release Notes");
    await visitorContext.close();
  } finally {
    await context.close();
    await browser.close();
  }
});

test("shows an error for a broken share link and keeps the session document", { timeout: 20000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await routeStaticFiles(page);
  try {
    await page.goto(appUrl);
    await page.locator("#file-input").setInputFiles(samplePath);
    await page.locator("#preview").getByText("Release Notes").first().waitFor();

    await page.goto(`${appUrl}#d=not-a-payload`);
    await assertVisibleText(page, "Release Notes");
    assert.match(await page.locator("#upload-error").textContent(), /not valid/);
    assert.doesNotMatch(await page.evaluate(() => window.location.hash), /d=/);
  } finally {
    await browser.close();
  }
});

test("edits a shared document without replacing the local session and shares the changes", { timeout: 20000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await routeStaticFiles(page);
  try {
    await page.goto(appUrl);
    await page.locator("#file-input").setInputFiles(samplePath);
    await page.locator("#preview").getByRole("heading", { name: "Release Notes" }).waitFor();
    const sharedHash = await page.evaluate(async () => {
      const { encodeShare } = await import("/src/share.js");
      return `#d=${await encodeShare("# Shared draft", "shared.md")}`;
    });
    await page.goto(`${appUrl}${sharedHash}`);
    await page.locator("#preview").getByRole("heading", { name: "Shared draft" }).waitFor();
    await page.getByRole("button", { name: "Edit Markdown source" }).click();
    await page.getByRole("textbox", { name: "Markdown source" }).fill("# Edited shared draft");
    assert.doesNotMatch(await page.evaluate(() => window.location.hash), /d=/);
    await page.getByRole("button", { name: "Show Markdown preview" }).click();
    await assertVisibleText(page, "Edited shared draft");
    assert.match(await page.evaluate(() => localStorage.getItem("md-viewer-document")), /Release Notes/);

    await page.getByRole("button", { name: "Copy a shareable link" }).click();
    await page.locator("#status", { hasText: /shareable link/i }).waitFor();
    const updatedUrl = page.url();
    const visitor = await browser.newPage();
    await routeStaticFiles(visitor);
    await visitor.goto(updatedUrl);
    await visitor.locator("#preview").getByRole("heading", { name: "Edited shared draft" }).waitFor();
    await visitor.getByRole("button", { name: "Edit Markdown source" }).click();
    assert.equal(await visitor.getByRole("textbox", { name: "Markdown source" }).inputValue(), "# Edited shared draft");
    await page.goto(appUrl);
    await page.reload();
    await assertVisibleText(page, "Release Notes");
  } finally {
    await browser.close();
  }
});

test("ignores empty and oversized share links without touching the session", { timeout: 20000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await routeStaticFiles(page);
  try {
    await page.goto(appUrl);
    await page.locator("#file-input").setInputFiles(samplePath);
    await page.locator("#preview").getByText("Release Notes").first().waitFor();

    const empty = await page.evaluate(async () => (await import("/src/share.js")).encodeShare("", "empty.md"));
    await page.goto("about:blank");
    await page.goto(`${appUrl}#d=${empty}`);
    await page.locator("#upload-error", { hasText: "not valid" }).waitFor();
    await assertVisibleText(page, "Release Notes");
    assert.match(await page.locator("#upload-error").textContent(), /not valid/);
    assert.match(await page.evaluate(() => localStorage.getItem("md-viewer-document")), /Release Notes/);

    await page.goto("about:blank");
    await page.goto(`${appUrl}#d=u${"A".repeat(40000)}`);
    await page.locator("#upload-error", { hasText: "not valid" }).waitFor();
    await assertVisibleText(page, "Release Notes");
    assert.match(await page.locator("#upload-error").textContent(), /not valid/);
  } finally {
    await browser.close();
  }
});

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

async function assertVisibleText(page, text) {
  assert.equal(await page.locator("#preview").getByText(text, { exact: true }).first().isVisible(), true);
}
