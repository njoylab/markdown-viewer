import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_SHARE_URL_LENGTH,
  SHARE_PARAM,
  buildShareUrl,
  decodeBase64Url,
  decodeShare,
  encodeBase64Url,
  encodeShare,
  readSharePayload,
  stripShareParam
} from "../src/share.js";

const sample = {
  markdown: "# Release Notes\n\n- Added **upload** support\n- Kept unsafe HTML escaped\n",
  name: "notes.md"
};

test("round trips a document through a compressed payload", async () => {
  const payload = await encodeShare(sample.markdown, sample.name);
  const json = JSON.stringify({ v: 1, n: sample.name, m: sample.markdown });
  const plainLength = encodeBase64Url(new TextEncoder().encode(json)).length + 1;

  assert.match(payload, /^z[\w-]+$/);
  assert.ok(payload.length < plainLength, `${payload.length} vs ${plainLength}`);
  assert.deepEqual(await decodeShare(payload), sample);
});

test("keeps unicode and empty payloads readable", async () => {
  const markdown = "# Città — naïve ✅\n\nCiao 👋\n";
  const payload = await encodeShare(markdown, "");

  assert.deepEqual(await decodeShare(payload), { markdown, name: "" });
});

test("compresses large documents well below the source size", async () => {
  const markdown = "# Notes\n\nRepeat this line many times.\n".repeat(500);
  const payload = await encodeShare(markdown, "");

  assert.ok(payload.length < markdown.length / 10, payload.length);
  assert.deepEqual(await decodeShare(payload), { markdown, name: "" });
});

test("rejects payloads that are not share links", async () => {
  assert.equal(await decodeShare(""), null);
  assert.equal(await decodeShare(null), null);
  assert.equal(await decodeShare("zz_not-valid"), null);
  assert.equal(await decodeShare(`u${encodeBase64Url(new TextEncoder().encode("not json"))}`), null);
  assert.equal(await decodeShare(`u${encodeBase64Url(new TextEncoder().encode(JSON.stringify({ v: 1 })))}`), null);
});

test("encodes and decodes base64url bytes without padding", () => {
  const bytes = new Uint8Array([251, 255, 190, 0, 1, 2]);
  const encoded = encodeBase64Url(bytes);

  assert.doesNotMatch(encoded, /[+/=]/);
  assert.deepEqual(decodeBase64Url(encoded), bytes);
});

test("reads the payload from a query string", () => {
  assert.equal(readSharePayload("?d=abc"), "abc");
  assert.equal(readSharePayload("?theme=dark&d=abc"), "abc");
  assert.equal(readSharePayload("?theme=dark"), null);
  assert.equal(readSharePayload(""), null);
});

test("builds a share url that keeps the current hash", async () => {
  const payload = await encodeShare(sample.markdown, sample.name);
  const url = buildShareUrl(
    { origin: "https://example.com", pathname: "/viewer/", hash: "#highlights" },
    payload
  );

  assert.equal(url, `https://example.com/viewer/?${SHARE_PARAM}=${payload}#highlights`);
  assert.equal(readSharePayload(new URL(url).search), payload);
});

test("strips the share param while keeping other params and the hash", () => {
  assert.equal(
    stripShareParam({ pathname: "/viewer/", search: "?theme=dark&d=abc", hash: "#top" }),
    "/viewer/?theme=dark#top"
  );
  assert.equal(stripShareParam({ pathname: "/viewer/", search: "?d=abc", hash: "" }), "/viewer/");
  assert.equal(
    stripShareParam({ pathname: "/viewer/", search: "?theme=dark", hash: "#top" }),
    "/viewer/?theme=dark#top"
  );
  assert.equal(
    stripShareParam({ pathname: "/viewer/", search: "?d=abc", hash: "#top" }, { keepHash: false }),
    "/viewer/"
  );
});

test("keeps a realistic document inside the safe url budget", async () => {
  const markdown = `# Project Plan\n\n${"A detailed note about the plan. ".repeat(200)}\n`;
  const payload = await encodeShare(markdown, "plan.md");
  const url = buildShareUrl({ origin: "https://example.com", pathname: "/viewer/", hash: "" }, payload);

  assert.ok(url.length < MAX_SHARE_URL_LENGTH, url.length);
});