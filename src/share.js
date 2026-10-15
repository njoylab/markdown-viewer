export const SHARE_PARAM = "d";
export const MAX_SHARE_URL_LENGTH = 30000;
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
  const compressed = await compress(plain);
  const prefix = compressed.length < plain.length ? COMPRESSED_PREFIX : PLAIN_PREFIX;
  const bytes = prefix === COMPRESSED_PREFIX ? compressed : plain;
  return `${prefix}${encodeBase64Url(bytes)}`;
}

export async function decodeShare(payload) {
  const value = String(payload ?? "").trim();
  const prefix = value.slice(0, 1);
  if (prefix !== COMPRESSED_PREFIX && prefix !== PLAIN_PREFIX) {
    return null;
  }

  let bytes;
  try {
    bytes = decodeBase64Url(value.slice(1));
    if (prefix === COMPRESSED_PREFIX) {
      bytes = await decompress(bytes);
    }
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || typeof parsed.m !== "string") {
      return null;
    }
    return { markdown: parsed.m, name: typeof parsed.n === "string" ? parsed.n : "" };
  } catch {
    return null;
  }
}

export function readSharePayload(search) {
  const params = new URLSearchParams(String(search ?? ""));
  const value = params.get(SHARE_PARAM);
  return value === null || value === "" ? null : value;
}

export function buildShareUrl(location, payload) {
  const base = `${location.origin}${location.pathname}`;
  const params = new URLSearchParams();
  params.set(SHARE_PARAM, payload);
  return `${base}?${params.toString()}${location.hash}`;
}

export function stripShareParam(location, options = {}) {
  const params = new URLSearchParams(location.search);
  const hash = options.keepHash === false ? "" : location.hash;
  if (!params.has(SHARE_PARAM)) {
    return `${location.pathname}${location.search}${hash}`;
  }
  params.delete(SHARE_PARAM);
  const query = params.toString();
  return `${location.pathname}${query === "" ? "" : `?${query}`}${hash}`;
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
    return await runStream(bytes, new CompressionStream("deflate-raw"));
  } catch {
    return bytes;
  }
}

async function decompress(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("DecompressionStream is not supported");
  }
  return await runStream(bytes, new DecompressionStream("deflate-raw"));
}

async function runStream(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}