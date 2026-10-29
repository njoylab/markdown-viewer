import assert from "node:assert/strict";
import test from "node:test";
import { createSlugger, plainText, slugify } from "../src/slug.js";

test("slugifies heading text", () => {
  assert.equal(slugify("Release Notes"), "release-notes");
  assert.equal(slugify("  Getting   started  "), "getting-started");
  assert.equal(slugify("Città e dintorni"), "citta-e-dintorni");
  assert.equal(slugify("What's new? (v2)"), "whats-new-v2");
});

test("falls back to a generic slug for empty text", () => {
  assert.equal(slugify(""), "section");
  assert.equal(slugify("###"), "section");
});

test("strips inline markdown from heading text", () => {
  assert.equal(plainText("Use **bold** and `code`"), "Use bold and code");
  assert.equal(plainText("A [link](https://x.com)"), "A link");
  assert.equal(plainText("`[a](https://b.com)`"), "[a](https://b.com)");
});

test("keeps slugs unique inside one document", () => {
  const slug = createSlugger();

  assert.equal(slug("Setup"), "setup");
  assert.equal(slug("Setup"), "setup-1");
  assert.equal(slug("Setup"), "setup-2");
  assert.equal(slug("Other"), "other");
});

test("avoids collisions between generated suffixes and literal heading names", () => {
  for (const names of [["Foo", "Foo", "Foo-1"], ["Foo-1", "Foo", "Foo"]]) {
    const slug = createSlugger();
    const ids = names.map(slug);
    assert.equal(new Set(ids).size, names.length);
  }
});
