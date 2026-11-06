import { escapeHtml } from "./html.js";
import { highlight } from "./highlight.js";
import { safeUrl } from "./sanitize.js";
import { createSlugger, plainText } from "./slug.js";

const TOKEN_START = "\uE000";
const TOKEN_END = "\uE001";
const TOKEN_PATTERN = /\uE000(\d+)\uE001/g;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uE000\uE001]/g;
const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*(.*)$/;
const INDENTED_CODE = /^(?: {4}|\t)/;
const BLOCKQUOTE = /^>\s?(.*)$/;
const HEADING = /^(#{1,6})\s+(.+)$/;
const UNORDERED_LIST = /^[-*]\s+(.+)$/;
const ORDERED_LIST = /^(\d+)\.\s+(.+)$/;
const TABLE_END_BLOCKS = [FENCE, INDENTED_CODE, BLOCKQUOTE, HEADING, UNORDERED_LIST, ORDERED_LIST];
const MAX_QUOTE_DEPTH = 64;
const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const TASK_ITEM = /^\[( |x|X)\][ \t]+([\s\S]+)$/;
const LANGUAGE_NAME = /[^a-z0-9_+#.-]/g;
const ALIGNMENT = { left: "align-left", center: "align-center", right: "align-right" };

export function renderMarkdown(markdown, options = {}) {
  const headings = Array.isArray(options.headings) ? options.headings : null;
  const lines = String(markdown).replace(/\r\n?/g, "\n").replace(CONTROL_CHARS, "").split("\n");
  const slug = createSlugger(options.reservedIds);
  const headingId = (level, text) => {
    const id = slug(text);
    if (headings) {
      headings.push({ level, text: plainText(text), id });
    }
    return id;
  };
  return renderLines(lines, headingId);
}

function renderLines(lines, headingId, quoteDepth = 0) {
  const blocks = [];
  let list = null;
  let code = null;
  let paragraph = [];
  let quote = [];

  const closeList = () => {
    if (list) {
      const attr = list.type === "ol" && list.start > 1 ? ` start="${list.start}"` : "";
      blocks.push(`<${list.type}${attr}>${list.items.map(renderListItem).join("")}</${list.type}>`);
      list = null;
    }
  };

  const closeCode = () => {
    if (code) {
      const body = code.indented ? trimTrailingBlankLines(code.lines) : code.lines;
      if (body.length > 0) {
        blocks.push(`<pre><code${codeAttributes(code.language)}>${codeContent(body.join("\n"), code.language)}</code></pre>`);
      }
      code = null;
    }
  };

  const closeParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(`<p>${formatInline(paragraph.join("\n"))}</p>`);
      paragraph = [];
    }
  };

  const closeQuote = () => {
    if (quote.length > 0) {
      blocks.push(`<blockquote>${renderLines(quote, headingId, quoteDepth + 1)}</blockquote>`);
      quote = [];
    }
  };

  const closeText = () => {
    closeList();
    closeParagraph();
    closeQuote();
  };

  for (let cursor = 0; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (code) {
      if (isFenceClose(line, code)) {
        closeCode();
        continue;
      }
      if (!code.indented || line.trim() === "" || INDENTED_CODE.test(line)) {
        code.lines.push(code.indented ? dedentIndented(line) : line);
        continue;
      }
      closeCode();
    }

    const fence = FENCE.exec(line);
    if (fence) {
      closeText();
      code = {
        marker: fence[2][0],
        length: fence[2].length,
        language: parseLanguage(fence[3]),
        lines: [],
        indented: false
      };
      continue;
    }

    if (INDENTED_CODE.test(line) && paragraph.length === 0 && quote.length === 0) {
      closeList();
      code = { marker: "", length: 0, language: "", lines: [dedentIndented(line)], indented: true };
      continue;
    }

    if (!line.trim()) {
      closeText();
      continue;
    }

    const quoted = BLOCKQUOTE.exec(line);
    if (quoted) {
      closeList();
      if (quoteDepth === MAX_QUOTE_DEPTH) {
        paragraph.push(line);
      } else {
        closeParagraph();
        quote.push(quoted[1]);
      }
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      closeText();
      const level = heading[1].length;
      blocks.push(`<h${level} id="${headingId(level, heading[2])}">${formatInline(heading[2])}</h${level}>`);
      continue;
    }

    const table = readTable(lines, cursor);
    if (table) {
      closeText();
      blocks.push(renderTable(table.header, table.alignments, table.rows));
      cursor = table.end - 1;
      continue;
    }

    const unordered = UNORDERED_LIST.exec(line);
    if (unordered) {
      closeParagraph();
      closeQuote();
      if (!list || list.type !== "ul") {
        closeList();
        list = { type: "ul", items: [] };
      }
      list.items.push(unordered[1]);
      continue;
    }

    const ordered = ORDERED_LIST.exec(line);
    if (ordered) {
      closeParagraph();
      closeQuote();
      const start = Number(ordered[1]);
      if (!list || list.type !== "ol") {
        closeList();
        list = { type: "ol", start, items: [] };
      }
      list.items.push(ordered[2]);
      continue;
    }

    closeList();
    closeQuote();
    paragraph.push(line);
  }

  closeCode();
  closeText();

  return blocks.join("\n");
}

function formatInline(value) {
  const tokens = [];
  const stash = (html) => {
    tokens.push(html);
    return TOKEN_START + (tokens.length - 1) + TOKEN_END;
  };

  const text = [];
  let plain = "";
  let index = 0;

  const flush = () => {
    if (plain.length > 0) {
      text.push(plain);
      plain = "";
    }
  };

  while (index < value.length) {
    if (value[index] === "`") {
      const openLength = readDelimiterRun(value, index, "`");
      const closeIndex = findClosingRun(value, index + openLength, openLength);
      if (closeIndex !== -1) {
        flush();
        const content = value.slice(index + openLength, closeIndex);
        text.push(stash(`<code>${escapeHtml(normalizeCodeSpan(content))}</code>`));
        index = closeIndex + openLength;
        continue;
      }
    }
    plain += value[index];
    index += 1;
  }
  flush();

  const inline = text
    .join("")
    .replace(LINK, (match, label, url) => renderLink(label, url, stash));

  return restoreTokens(applyEmphasis(escapeHtml(inline)), tokens);
}

function renderLink(label, rawUrl, stash) {
  const url = safeUrl(rawUrl);
  if (!url) {
    return `[${label}](${rawUrl})`;
  }
  return stash(`<a href="${escapeHtml(url)}" rel="noreferrer noopener">${applyEmphasis(escapeHtml(label))}</a>`);
}

function applyEmphasis(text) {
  return text
    .replace(/\*\*(?!\s)(.+?)(?<!\s)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(?!\s)([^*\n]+?)(?<!\s)\*/g, "<em>$1</em>");
}

function restoreTokens(text, tokens) {
  return text.replace(TOKEN_PATTERN, (match, index) => restoreTokens(tokens[Number(index)], tokens));
}

function renderListItem(item) {
  const task = TASK_ITEM.exec(item);
  if (!task) {
    return `<li>${formatInline(item)}</li>`;
  }
  const checked = task[1].toLowerCase() === "x" ? " checked" : "";
  return `<li class="task-item"><input class="task-checkbox" type="checkbox" disabled${checked}> ${formatInline(task[2])}</li>`;
}

function parseLanguage(info) {
  const [name = ""] = info.trim().split(/\s+/);
  return name.toLowerCase().replace(LANGUAGE_NAME, "");
}

function codeAttributes(language) {
  return language ? ` class="language-${escapeHtml(language)}"` : "";
}

function codeContent(text, language) {
  return language ? highlight(text, language) : escapeHtml(text);
}

function readTable(lines, start) {
  const header = splitRow(lines[start]);
  const divider = splitRow(lines[start + 1]);
  if (!header || !divider || header.length !== divider.length || !isDividerRow(divider)) {
    return null;
  }

  const rows = [];
  let cursor = start + 2;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (TABLE_END_BLOCKS.some((pattern) => pattern.test(line))) {
      break;
    }
    const cells = splitRow(line);
    if (!cells) {
      break;
    }
    rows.push(cells);
    cursor += 1;
  }

  return { header, alignments: divider.map(readAlignment), rows, end: cursor };
}

function splitRow(line = "") {
  const text = line.trim();
  if (!text.includes("|")) {
    return null;
  }

  const cells = [];
  let start = 0;
  let cell = "";
  let hasSeparator = false;
  for (const match of text.matchAll(/\\[\\|]|\|/g)) {
    const token = match[0];
    if (token === "\\\\") {
      continue;
    }
    cell += text.slice(start, match.index);
    start = match.index + token.length;
    if (token === "\\|") {
      cell += "|";
      continue;
    }
    hasSeparator = true;
    if (match.index > 0) {
      cells.push(cell.trim());
    }
    cell = "";
  }
  if (!hasSeparator) {
    return null;
  }
  if (cell || start < text.length) {
    cells.push((cell + text.slice(start)).trim());
  }
  return cells;
}

function isDividerRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function readAlignment(cell) {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) {
    return ALIGNMENT.center;
  }
  if (right) {
    return ALIGNMENT.right;
  }
  if (left) {
    return ALIGNMENT.left;
  }
  return "";
}

function renderTable(header, alignments, rows) {
  const head = header
    .map((cell, index) => `<th${cellClass(alignments[index])}>${formatInline(cell)}</th>`)
    .join("");
  const body = rows
    .map((row) => {
      let cells = row.slice(0, header.length)
        .map((cell, index) => `<td${cellClass(alignments[index])}>${formatInline(cell)}</td>`)
        .join("");
      const missing = header.length - row.length;
      // Keep padding proportional to the row size even for very wide tables.
      if (missing > 0) {
        const attributes = missing === 1 ? cellClass(alignments[row.length]) : ` colspan="${missing}"`;
        cells += `<td${attributes}></td>`;
      }
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function cellClass(alignment) {
  return alignment ? ` class="${alignment}"` : "";
}

function stripControlChars(value) {
  return value.replace(CONTROL_CHARS, "");
}

function readDelimiterRun(value, index, delimiter) {
  let size = 0;
  while (value[index + size] === delimiter) {
    size += 1;
  }
  return size;
}

function findClosingRun(value, from, length) {
  let index = from;
  while (index < value.length) {
    if (value[index] === "`") {
      const size = readDelimiterRun(value, index, "`");
      if (size === length) {
        return index;
      }
      index += size;
      continue;
    }
    index += 1;
  }
  return -1;
}

function normalizeCodeSpan(content) {
  const stripped = stripControlChars(content);
  if (stripped.length > 2 && stripped.startsWith(" ") && stripped.endsWith(" ") && stripped.trim().length > 0) {
    return stripped.slice(1, -1);
  }
  return stripped;
}

function isFenceClose(line, code) {
  const match = FENCE.exec(line);
  if (!match) {
    return false;
  }
  const marker = match[2];
  const sameKind = marker[0] === code.marker && marker.length >= code.length;
  if (!sameKind) {
    return false;
  }
  return code.marker !== "`" || match[3].trim() === "";
}

function dedentIndented(line) {
  if (line.startsWith("\t")) {
    return line.slice(1);
  }
  return line.replace(/^ {1,4}/, "");
}

function trimTrailingBlankLines(lines) {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") {
    end -= 1;
  }
  return lines.slice(0, end);
}
