export const SHARE_KEY = "d";
export const HEADING_KEY = "h";
export const MAX_SHARE_URL_LENGTH = 30000;
// Incoming links are attacker-controlled, so both the payload and the inflated
// document are capped before anything is parsed or rendered.
export const MAX_PAYLOAD_LENGTH = MAX_SHARE_URL_LENGTH;
export const MAX_DECODED_BYTES = 2 * 1024 * 1024;
const FORMAT_VERSION = 1;
const COMPRESSED_PREFIX = "z";
const PLAIN_PREFIX = "u";
const CHUNK_SIZE = 0x8000;

export async function encodeShare(markdown, name = "") {
  const json = JSON.stringify({
    v: FORMAT_VERSION,
    n: String(name ?? ""),
    m: String(markdown ?? "")
  });
  const plain = new TextEncoder().encode(json);
  if (plain.length > MAX_DECODED_BYTES) {
    throw new RangeError("The shared document is too large");
  }
  const compressed = await compress(plain);
  const prefix = compressed.length < plain.length ? COMPRESSED_PREFIX : PLAIN_PREFIX;
  const bytes = prefix === COMPRESSED_PREFIX ? compressed : plain;
  return `${prefix}${encodeBase64Url(bytes)}`;
}

export async function decodeShare(payload) {
  const value = String(payload ?? "").trim();
  if (value.length > MAX_PAYLOAD_LENGTH) {
    return null;
  }
  const prefix = value.slice(0, 1);
  if (prefix !== COMPRESSED_PREFIX && prefix !== PLAIN_PREFIX) {
    return null;
  }

  let bytes;
  try {
    bytes = decodeBase64Url(value.slice(1));
    if (prefix === COMPRESSED_PREFIX) {
      bytes = await decompress(bytes, MAX_DECODED_BYTES);
    }
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    // An empty document is never shared, and accepting one would clear the
    // visitor's stored session.
    if (!parsed || typeof parsed !== "object" || typeof parsed.m !== "string" || parsed.m === "") {
      return null;
    }
    return { markdown: parsed.m, name: typeof parsed.n === "string" ? parsed.n : "" };
  } catch {
    return null;
  }
}

// The payload lives in the fragment so the document never reaches the server.
// Format: "#d=<payload>" or "#d=<payload>&h=<heading id>"; any other hash is a
// plain heading id. Heading ids never contain "=" or "&".
export function parseShareHash(hash) {
  const value = String(hash ?? "").replace(/^#/, "");
  const sharePrefix = `${SHARE_KEY}=`;
  if (!value.startsWith(sharePrefix)) {
    return { payload: null, heading: value };
  }

  const rest = value.slice(sharePrefix.length);
  const separator = rest.indexOf("&");
  const payload = separator === -1 ? rest : rest.slice(0, separator);
  const tail = separator === -1 ? "" : rest.slice(separator + 1);
  const headingPrefix = `${HEADING_KEY}=`;
  return {
    payload: payload === "" ? null : payload,
    heading: tail.startsWith(headingPrefix) ? tail.slice(headingPrefix.length) : ""
  };
}

export function buildShareHash(payload, headingId = "") {
  const heading = headingId ? encodeURIComponent(headingId) : "";
  if (!payload) {
    return heading === "" ? "" : `#${heading}`;
  }
  return `#${SHARE_KEY}=${payload}${heading === "" ? "" : `&${HEADING_KEY}=${heading}`}`;
}

export function buildShareUrl(location, payload, headingId = "") {
  return `${location.origin}${location.pathname}${buildShareHash(payload, headingId)}`;
}

export function encodeBase64Url(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK_SIZE));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function compress(bytes) {
  if (typeof CompressionStream !== "function") {
    return bytes;
  }
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return bytes;
  }
}

async function decompress(bytes, limit) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("DecompressionStream is not supported");
  }

  // Read chunk by chunk and stop once the limit is crossed, so a small payload
  // cannot inflate into an unbounded buffer.
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Error("The shared document is too large");
    }
    chunks.push(value);
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
