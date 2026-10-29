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

test("shows examples on empty load and renders a selected example", { timeout: 15000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await routeStaticFiles(page);
  try {
    await page.goto(appUrl);

    await assertVisibleText(page, "Try an example");
    await assertVisibleText(page, "Release notes");
    await assertVisibleText(page, "Project plan");
    await assertVisibleText(page, "Technical note");

    await page.getByRole("button", { name: "Technical note" }).click();

    await assertVisibleText(page, "Technical Note");
    await assertVisibleText(page, "Use inline code for commands and fenced blocks for snippets.");
    assert.match(await page.locator("pre code").textContent(), /const status = "ready";/);
    assert.equal(await page.getByText("No file loaded", { exact: true }).count(), 0);
  } finally {
    await browser.close();
  }
});

test("uploads and renders a markdown file", { timeout: 15000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await routeStaticFiles(page);
  try {
    await page.goto(appUrl);
    await page.locator("#file-input").setInputFiles(samplePath);

    const uploadButton = page.locator(".upload-button");
    await expectUploadAnimation(page, uploadButton);

    await assertVisibleText(page, "Release Notes");
    await assertVisibleText(page, "Highlights");
    await assertVisibleText(page, "Expected Result");

    assert.equal(await page.locator("strong").textContent(), "bold text");
    assert.equal(await page.locator("em").textContent(), "italic text");
    assert.equal(await page.locator("a[href='https://example.com']").textContent(), "public link");
    assert.match(await page.locator("pre code").textContent(), /const status = "rendered";/);
    assert.equal(await page.locator("script", { hasText: "alert" }).count(), 0);
  } finally {
    await browser.close();
  }
});

test("edits an uploaded file and restores the edited document on reload", { timeout: 15000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await routeStaticFiles(page);
  try {
    await page.goto(appUrl);
    await page.locator("#file-input").setInputFiles(samplePath);
    const toggle = page.locator("#edit-toggle");
    await toggle.click();

    const editor = page.getByRole("textbox", { name: "Markdown source" });
    await editor.waitFor({ state: "visible", timeout: 1500 });
    assert.equal(await editor.inputValue(), (await readFile(samplePath, "utf8")).replaceAll("\r\n", "\n"));
    assert.equal(await editor.evaluate((element) => element === document.activeElement), true);
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");

    await editor.fill("# Edited file\n\n## Updated section\n\n");
    await editor.press("ControlOrMeta+End");
    await editor.pressSequentially("copy + paste");
    await editor.evaluate((element) => {
      const data = new DataTransfer();
      data.setData("text/plain", "should stay in the editor");
      const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      if (event.defaultPrevented) {
        throw new Error("The global paste handler intercepted editing");
      }
    });
    await page.getByRole("button", { name: "Show Markdown preview" }).click();

    await assertVisibleText(page, "Edited file");
    await assertVisibleText(page, "copy + paste");
    assert.equal(await page.locator("#outline-list").getByRole("link", { name: "Updated section" }).isVisible(), true);
    await page.reload();
    await assertVisibleText(page, "Edited file");
    await toggle.click();
    assert.equal(await editor.inputValue(), "# Edited file\n\n## Updated section\n\ncopy + paste");
  } finally {
    await browser.close();
  }
});

test("keeps editing available for empty content and resets it when clearing or loading a file", { timeout: 15000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await routeStaticFiles(page);
  try {
    await page.goto(appUrl);
    await page.locator("#file-input").setInputFiles(samplePath);
    await page.locator("#edit-toggle").click();
    const editor = page.getByRole("textbox", { name: "Markdown source" });
    await editor.waitFor({ state: "visible", timeout: 1500 });
    await editor.fill("");
    await page.getByRole("button", { name: "Show Markdown preview" }).click();
    await page.getByRole("button", { name: "Edit Markdown source" }).click();
    await editor.fill("# Replacement draft");
    await page.locator("#file-input").setInputFiles(samplePath);
    await page.locator("#preview").getByRole("heading", { name: "Release Notes" }).waitFor();
    await assertVisibleText(page, "Release Notes");
    assert.equal(await editor.isVisible(), false);
    await page.locator("#edit-toggle").click();
    assert.match(await editor.inputValue(), /Release Notes/);
    await page.getByRole("button", { name: "Clear document" }).click();
    assert.equal(await editor.isVisible(), false);
    assert.equal(await page.locator("#editor").inputValue(), "");
    await assertVisibleText(page, "Ready to preview Markdown");
    await page.reload();
    await assertVisibleText(page, "Ready to preview Markdown");
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

async function expectUploadAnimation(page, locator) {
  await page.waitForFunction(() => {
    const element = document.querySelector(".upload-button");
    return element?.getAnimations().some(({ animationName }) => {
      return animationName === "upload-pulse";
    });
  });

  await locator.evaluate((element) => {
    return new Promise((resolve, reject) => {
      if (!element.classList.contains("is-uploading")) {
        reject(new Error("Upload button did not enter uploading animation state"));
        return;
      }

      const animation = element.getAnimations().find(({ animationName }) => {
        return animationName === "upload-pulse";
      });
      if (!animation) {
        reject(new Error("Upload button did not start upload-pulse animation"));
        return;
      }

      animation.finished.then(resolve, reject);
    });
  });
}
