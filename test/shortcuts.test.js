import assert from "node:assert/strict";
import test from "node:test";
import { SHORTCUTS, matchShortcut } from "../src/shortcuts.js";

function keyEvent(key, options = {}) {
  return { key, target: null, ctrlKey: false, metaKey: false, altKey: false, ...options };
}

test("maps the documented keys to actions", () => {
  assert.equal(matchShortcut(keyEvent("t")), "toggle-theme");
  assert.equal(matchShortcut(keyEvent("o")), "toggle-toc");
  assert.equal(matchShortcut(keyEvent("+")), "bigger-text");
  assert.equal(matchShortcut(keyEvent("=")), "bigger-text");
  assert.equal(matchShortcut(keyEvent("-")), "smaller-text");
  assert.equal(matchShortcut(keyEvent("c")), "copy-html");
  assert.equal(matchShortcut(keyEvent("s")), "share-link");
  assert.equal(matchShortcut(keyEvent("p")), "print");
  assert.equal(matchShortcut(keyEvent("Escape")), "close-toc");
  assert.equal(matchShortcut(keyEvent("Esc")), "close-toc");
});

test("ignores shifted letters so caps lock still works", () => {
  assert.equal(matchShortcut(keyEvent("T")), "toggle-theme");
});

test("ignores unknown keys and empty events", () => {
  assert.equal(matchShortcut(keyEvent("z")), null);
  assert.equal(matchShortcut(keyEvent("Shift")), null);
  assert.equal(matchShortcut(null), null);
  assert.equal(matchShortcut({}), null);
});

test("lets the browser handle browser shortcuts", () => {
  assert.equal(matchShortcut(keyEvent("p", { ctrlKey: true })), null);
  assert.equal(matchShortcut(keyEvent("c", { metaKey: true })), null);
  assert.equal(matchShortcut(keyEvent("t", { altKey: true })), null);
});

test("ignores keys typed inside editable elements", () => {
  const input = { tagName: "INPUT" };
  const textarea = { tagName: "TEXTAREA" };
  const editable = { tagName: "DIV", isContentEditable: true };

  assert.equal(matchShortcut(keyEvent("t", { target: input })), null);
  assert.equal(matchShortcut(keyEvent("t", { target: textarea })), null);
  assert.equal(matchShortcut(keyEvent("t", { target: editable })), null);
  assert.equal(matchShortcut(keyEvent("Escape", { target: input })), "close-toc");
});

test("every shortcut is documented with keys and a label", () => {
  for (const shortcut of SHORTCUTS) {
    assert.ok(shortcut.keys.length > 0, shortcut.action);
    assert.match(shortcut.label, /\S/);
  }
});