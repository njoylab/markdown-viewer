import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_DECODED_BYTES,
  MAX_PAYLOAD_LENGTH,
  MAX_SHARE_URL_LENGTH,
  buildShareHash,
  buildShareUrl,
  decodeBase64Url,
  decodeShare,
  encodeBase64Url,
  encodeShare,
  parseShareHash
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

test("rejects an empty shared document", async () => {
  assert.equal(await decodeShare(await encodeShare("", "empty.md")), null);
  assert.equal(await decodeShare(`u${encodeBase64Url(new TextEncoder().encode(JSON.stringify({ v: 1, m: "" })))}`), null);
});

test("rejects payloads longer than the link budget before decoding", async () => {
  const payload = `u${"A".repeat(MAX_PAYLOAD_LENGTH)}`;

  assert.equal(await decodeShare(payload), null);
});

test("rejects compressed payloads that inflate past the size limit", async () => {
  const json = new TextEncoder().encode(JSON.stringify({ v: 1, n: "", m: "a".repeat(MAX_DECODED_BYTES) }));
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const payload = `z${encodeBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()))}`;

  assert.ok(payload.length < MAX_PAYLOAD_LENGTH, payload.length);
  assert.equal(await decodeShare(payload), null);
});

test("parses the payload and heading from the fragment", () => {
  assert.deepEqual(parseShareHash("#d=zabc"), { payload: "zabc", heading: "" });
  assert.deepEqual(parseShareHash("#d=zabc&h=fixes"), { payload: "zabc", heading: "fixes" });
  assert.deepEqual(parseShareHash("#fixes"), { payload: null, heading: "fixes" });
  assert.deepEqual(parseShareHash("#d="), { payload: null, heading: "" });
  assert.deepEqual(parseShareHash(""), { payload: null, heading: "" });
});

test("builds fragments that round trip through the parser", () => {
  assert.equal(buildShareHash("zabc", "fixes"), "#d=zabc&h=fixes");
  assert.equal(buildShareHash("zabc"), "#d=zabc");
  assert.equal(buildShareHash("", "fixes"), "#fixes");
  assert.equal(buildShareHash("", ""), "");
  assert.deepEqual(parseShareHash(buildShareHash("zabc", "città")), { payload: "zabc", heading: "citt%C3%A0" });
});

test("builds a share url with the payload in the fragment only", async () => {
  const payload = await encodeShare(sample.markdown, sample.name);
  const url = new URL(buildShareUrl(
    { origin: "https://example.com", pathname: "/viewer/", search: "?theme=dark", hash: "#highlights" },
    payload,
    "highlights"
  ));

  assert.equal(url.search, "");
  assert.equal(url.pathname, "/viewer/");
  assert.deepEqual(parseShareHash(url.hash), { payload, heading: "highlights" });
});

test("keeps a realistic document inside the safe url budget", async () => {
  const markdown = `# Project Plan\n\n${"A detailed note about the plan. ".repeat(200)}\n`;
  const payload = await encodeShare(markdown, "plan.md");
  const url = buildShareUrl({ origin: "https://example.com", pathname: "/viewer/" }, payload);

  assert.ok(url.length < MAX_SHARE_URL_LENGTH, url.length);
});