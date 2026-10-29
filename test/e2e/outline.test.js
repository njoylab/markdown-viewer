import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { contentType } from "../../scripts/content-type.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../..");
const appUrl = "http://markdown-viewer.test/";

function longDocument(sections = 12) {
  const parts = ["# Field guide"];
  for (let index = 1; index <= sections; index += 1) {
    parts.push(`## Section ${index}`, `Body copy for section ${index}.`, "Extra line to make the page scroll.".repeat(6));
  }
  return parts.join("\n\n");
}

test("builds an outline from the headings of the loaded document", { timeout: 20000 }, async () => {
  const { browser, page } = await openPage();
  try {
    await paste(page, longDocument(4));

    await page.waitForSelector("#outline:not([hidden])");
    assert.deepEqual(
      await page.locator(".outline-item a").allTextContents(),
      ["Section 1", "Section 2", "Section 3", "Section 4"]
    );
    assert.equal(await page.locator("#preview h2#section-2").count(), 1);
    assert.equal(await page.locator("#toc-toggle").getAttribute("aria-pressed"), "true");
  } finally {
    await browser.close();
  }
});

test("hides the outline when the document has no headings", { timeout: 20000 }, async () => {
  const { browser, page } = await openPage();
  try {
    await paste(page, "Just a paragraph.");

    assert.equal(await page.locator("#outline").isVisible(), false);
    assert.equal(await page.locator("#toc-toggle").getAttribute("aria-pressed"), "false");
  } finally {
    await browser.close();
  }
});

test("keeps heading anchors distinct from interface ids across edits and reloads", { timeout: 20000 }, async () => {
  const { browser, page } = await openPage();
  try {
    await paste(page, "## Preview\n\n## Workspace\n\n## Main");
    const ids = await page.locator("#preview h2").evaluateAll((nodes) => nodes.map((node) => node.id));
    for (const id of ids) {
      assert.equal(await page.locator(`[id="${id}"]`).count(), 1);
    }
    await page.locator("#outline-list").getByRole("link", { name: "Workspace", exact: true }).click();
    assert.equal(new URL(page.url()).hash, `#${ids[1]}`);
    await page.getByRole("button", { name: "Edit Markdown source" }).click();
    await page.getByRole("textbox", { name: "Markdown source" }).fill("## Preview\n\n## Workspace\n\n## Main\n\nEdited");
    await page.getByRole("button", { name: "Show Markdown preview" }).click();
    assert.deepEqual(await page.locator("#preview h2").evaluateAll((nodes) => nodes.map((node) => node.id)), ids);
    await page.reload();
    await page.locator("#preview h2").first().waitFor();
    assert.deepEqual(await page.locator("#preview h2").evaluateAll((nodes) => nodes.map((node) => node.id)), ids);
  } finally {
    await browser.close();
  }
});

test("scrolls to a heading and updates the hash when an outline link is used", { timeout: 20000 }, async () => {
  const { browser, page } = await openPage();
  try {
    await paste(page, longDocument(8));

    await page.locator('.outline-item a[data-heading="section-5"]').click();

    assert.equal(await page.evaluate(() => location.hash), "#section-5");
    await page.waitForFunction(() => document.getElementById("section-5").getBoundingClientRect().top < 120);
    assert.equal(
      await page.locator('.outline-item a[data-heading="section-5"]').getAttribute("aria-current"),
      "true"
    );
  } finally {
    await browser.close();
  }
});

test("marks the visible section as active while scrolling", { timeout: 20000 }, async () => {
  const { browser, page } = await openPage();
  try {
    await paste(page, longDocument(10));

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForFunction(
      () => document.querySelector('.outline-item a[aria-current="true"]')?.dataset.heading === "section-10"
    );

    assert.equal(await page.evaluate(() => location.hash), "#section-10");
  } finally {
    await browser.close();
  }
});

test("restores the document and scrolls to a deep link", { timeout: 20000 }, async () => {
  const { browser, page } = await openPage();
  try {
    await paste(page, longDocument(8));

    await page.goto("about:blank");
    await page.goto(`${appUrl}#section-6`);
    await page.waitForSelector("#outline:not([hidden])");
    await page.waitForFunction(() => document.getElementById("section-6").getBoundingClientRect().top < 120);
    assert.equal(
      await page.locator('.outline-item a[data-heading="section-6"]').getAttribute("aria-current"),
      "true"
    );
  } finally {
    await browser.close();
  }
});

test("ignores a deep link that does not match any heading", { timeout: 20000 }, async () => {
  const { browser, page } = await openPage();
  try {
    await paste(page, longDocument(4));

    await page.goto(`${appUrl}#missing-section`);

    await page.waitForSelector("#outline:not([hidden])");
    assert.equal(await page.locator('.outline-item a[data-heading="missing-section"]').count(), 0);
    assert.equal(await page.evaluate(() => window.scrollY), 0);
  } finally {
    await browser.close();
  }
});

test("toggles the outline with the button and the Escape key", { timeout: 20000 }, async () => {
  const { browser, page } = await openPage();
  try {
    await paste(page, longDocument(3));
    await page.locator("#toc-toggle").click();
    assert.equal(await page.locator("#outline").isVisible(), false);

    await page.locator("#preview").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("o");
    assert.equal(await page.locator("#outline").isVisible(), true);

    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#outline").isVisible(), false);
  } finally {
    await browser.close();
  }
});

test("prints the document from the toolbar and the keyboard", { timeout: 20000 }, async () => {
  const { browser, page } = await openPage(stubPrint);
  try {
    await paste(page, longDocument(3));

    await page.locator("#print").click();
    assert.equal(await page.evaluate(() => window.__prints), 1);

    await page.locator("#preview").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("p");
    assert.equal(await page.evaluate(() => window.__prints), 2);
  } finally {
    await browser.close();
  }
});

test("copies the rendered html to the clipboard", { timeout: 20000 }, async () => {
  const { browser, page } = await openPage(stubClipboard);
  try {
    await paste(page, "# Copied\n\nBody.");

    await page.locator("#copy-html").click();

    assert.match(await page.evaluate(() => window.__copied.at(-1)), /<h1 id="copied">Copied<\/h1>/);
    await assertVisibleText(page, "Copied the rendered HTML.");
  } finally {
    await browser.close();
  }
});

async function openPage(beforeLoad) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await routeStaticFiles(page);
  if (beforeLoad) {
    await beforeLoad(page);
  }
  await page.goto(appUrl);
  return { browser, page };
}

async function stubPrint(page) {
  await page.addInitScript(() => {
    window.__prints = 0;
    window.print = () => {
      window.__prints += 1;
    };
  });
}

async function stubClipboard(page) {
  await page.addInitScript(() => {
    window.__copied = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__copied.push(text);
        }
      }
    });
  });
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

async function assertVisibleText(page, text) {
  assert.equal(await page.getByText(text, { exact: true }).isVisible(), true);
}
