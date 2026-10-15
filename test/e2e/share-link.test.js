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

    const status = page.locator("#status");
    await assertVisibleText(page, "Release Notes");
    assert.match(await status.textContent(), /shareable link/i);

    const search = await page.evaluate(() => window.location.search);
    assert.match(search, /\?d=z[\w-]+$/);

    const stored = await page.evaluate(() => localStorage.getItem("md-viewer-document"));
    assert.match(stored, /Release Notes/);

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await routeStaticFiles(visitor);
    await visitor.goto(`${appUrl}${search}`);

    await assertVisibleText(visitor, "Release Notes");
    await assertVisibleText(visitor, "Expected Result");
    assert.match(await visitor.locator("#status").textContent(), /Loaded a shared document/);
    assert.equal(await visitor.evaluate(() => localStorage.getItem("md-viewer-document")), null);
    assert.match(await visitor.evaluate(() => window.location.search), /\?d=z[\w-]+$/);
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

    await page.goto(`${appUrl}?d=not-a-payload`);
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