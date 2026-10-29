export const DOCUMENT_STORAGE_KEY = "md-viewer-document";
export const DOCUMENT_NAME_STORAGE_KEY = "md-viewer-document-name";
export const MAX_DOCUMENT_LENGTH = 500000;

export function readDocument(storage) {
  try {
    const markdown = storage?.getItem(DOCUMENT_STORAGE_KEY) ?? "";
    const name = storage?.getItem(DOCUMENT_NAME_STORAGE_KEY) ?? "";
    return markdown === "" ? null : { markdown, name };
  } catch {
    return null;
  }
}

export function storeDocument(storage, markdown, name = "") {
  if (!storage) {
    return false;
  }
  const text = String(markdown ?? "");
  if (text === "") {
    return clearDocument(storage);
  }
  if (text.length > MAX_DOCUMENT_LENGTH) {
    return false;
  }
  try {
    storage.setItem(DOCUMENT_STORAGE_KEY, text);
    storage.setItem(DOCUMENT_NAME_STORAGE_KEY, String(name ?? ""));
    return true;
  } catch {
    return false;
  }
}

export function clearDocument(storage) {
  if (!storage) {
    return false;
  }
  try {
    storage.removeItem(DOCUMENT_STORAGE_KEY);
    storage.removeItem(DOCUMENT_NAME_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
