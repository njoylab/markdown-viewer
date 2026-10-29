import { extractFrontmatter, renderFrontmatter } from "./frontmatter.js";
import { renderMarkdown } from "./markdown.js";

export function renderDocument(markdown, options = {}) {
  const source = String(markdown ?? "");
  const { entries, body } = extractFrontmatter(source);
  const headings = [];
  const html = renderFrontmatter(entries) + renderMarkdown(body, { headings, reservedIds: options.reservedIds });

  return {
    html,
    headings,
    title: documentTitle(entries, headings)
  };
}

function documentTitle(entries, headings) {
  const entry = entries.find((item) => item.key.toLowerCase() === "title")?.value;
  return entry || headings.find((heading) => heading.level === 1)?.text || "";
}
