import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown } from "../src/markdown.js";

test("escapes link destinations exactly once while preserving safe labels", () => {
  assert.equal(
    renderMarkdown('[**A & B**](https://example.com/?a=1&b="two")'),
    '<p><a href="https://example.com/?a=1&amp;b=&quot;two&quot;" rel="noreferrer noopener"><strong>A &amp; B</strong></a></p>'
  );
  assert.equal(renderMarkdown('[x](javascript:a&b)'), '<p>[x](javascript:a&amp;b)</p>');
});

test("renders headings, emphasis and lists", () => {
  const html = renderMarkdown("# Title\n\nA **bold** and *soft* line.\n\n- One\n- Two");

  assert.match(html, /<h1 id="title">Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>soft<\/em>/);
  assert.match(html, /<ul><li>One<\/li><li>Two<\/li><\/ul>/);
});

test("escapes unsafe html", () => {
  const html = renderMarkdown("# <script>alert(1)</script>");

  assert.equal(html, '<h1 id="alert1">&lt;script&gt;alert(1)&lt;/script&gt;</h1>');
});

test("renders fenced code blocks", () => {
  const html = renderMarkdown("```\nconst value = 1 < 2;\n```");

  assert.equal(html, "<pre><code>const value = 1 &lt; 2;</code></pre>");
});

test("highlights fenced code blocks that declare a language", () => {
  const html = renderMarkdown("```js\nconst value = 1 < 2;\n```");

  assert.equal(
    html,
    '<pre><code class="language-js"><span class="tok-keyword">const</span> value = ' +
      '<span class="tok-number">1</span> &lt; <span class="tok-number">2</span>;</code></pre>'
  );
});

test("keeps code in unknown languages escaped without tokens", () => {
  assert.equal(
    renderMarkdown("```brainfuck\n+[-<>] <b>\n```"),
    '<pre><code class="language-brainfuck">+[-&lt;&gt;] &lt;b&gt;</code></pre>'
  );
});

test("drops unsafe characters from the language name", () => {
  const html = renderMarkdown('```js" onmouseover="alert(1)\nconst a = 1;\n```');

  assert.match(html, /^<pre><code class="language-js[^"]*"/);
  assert.doesNotMatch(html, /onmouseover="alert/);
});

test("keeps inline code literal", () => {
  assert.equal(renderMarkdown("`**not bold**`"), "<p><code>**not bold**</code></p>");
  assert.equal(
    renderMarkdown("`[a](https://b.com)`"),
    "<p><code>[a](https://b.com)</code></p>"
  );
});

test("renders nested emphasis", () => {
  assert.equal(renderMarkdown("**a *b* c**"), "<p><strong>a <em>b</em> c</strong></p>");
});

test("renders headings up to level six", () => {
  const html = renderMarkdown("#### Four\n\n###### Six");

  assert.equal(html, '<h4 id="four">Four</h4>\n<h6 id="six">Six</h6>');
});

test("keeps the ordered list start number", () => {
  assert.equal(renderMarkdown("5. five\n6. six"), '<ol start="5"><li>five</li><li>six</li></ol>');
  assert.equal(renderMarkdown("1. one"), "<ol><li>one</li></ol>");
});

test("joins consecutive lines into one paragraph", () => {
  assert.equal(renderMarkdown("line one\nline two"), "<p>line one\nline two</p>");
});

test("renders blockquotes", () => {
  assert.equal(
    renderMarkdown("> quoted *line*\n> more\n\nafter"),
    "<blockquote><p>quoted <em>line</em>\nmore</p></blockquote>\n<p>after</p>"
  );
});

test("applies emphasis inside link labels", () => {
  assert.equal(
    renderMarkdown("[**bold**](https://x.com)"),
    '<p><a href="https://x.com" rel="noreferrer noopener"><strong>bold</strong></a></p>'
  );
});

test("ignores unsafe link schemes", () => {
  const html = renderMarkdown("[x](javascript:alert(1))");

  assert.equal(html, "<p>[x](javascript:alert(1))</p>");
});

test("renders relative links and anchors", () => {
  assert.equal(
    renderMarkdown("[a](./notes.md) [b](#section)"),
    '<p><a href="./notes.md" rel="noreferrer noopener">a</a> <a href="#section" rel="noreferrer noopener">b</a></p>'
  );
});

test("keeps mailto links and drops protocol relative ones", () => {
  assert.equal(
    renderMarkdown("[mail](mailto:a@b.com)"),
    '<p><a href="mailto:a@b.com" rel="noreferrer noopener">mail</a></p>'
  );
  assert.equal(renderMarkdown("[x](//evil.example.com)"), "<p>[x](//evil.example.com)</p>");
});

test("gives every heading a stable anchor id", () => {
  assert.equal(
    renderMarkdown("## Getting started\n\n## Getting started"),
    '<h2 id="getting-started">Getting started</h2>\n<h2 id="getting-started-1">Getting started</h2>'
  );
});

test("collects the rendered headings with their plain text", () => {
  const headings = [];

  renderMarkdown("# Release **notes**\n\n## 100% done\n\ntext", { headings });

  assert.deepEqual(headings, [
    { level: 1, text: "Release notes", id: "release-notes" },
    { level: 2, text: "100% done", id: "100-done" }
  ]);
});

test("keeps heading ids usable as css hooks", () => {
  const html = renderMarkdown('## A "quoted" & odd heading');

  assert.match(html, /<h2 id="a-quoted-odd-heading">/);
});

test("escapes html that could inject attributes or handlers", () => {
  const html = renderMarkdown('<img src=x onerror="alert(1)">');

  assert.equal(html, "<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>");
  assert.doesNotMatch(html, /<img/);
});

test("cannot break out of a link href attribute", () => {
  const html = renderMarkdown('[x](https://x.com" onmouseover="alert(1))');

  assert.equal(html, "<p>[x](https://x.com&quot; onmouseover=&quot;alert(1))</p>");
  assert.doesNotMatch(html, /onmouseover="alert/);
});

test("escapes single quotes used to break out of attributes", () => {
  const html = renderMarkdown("<p class='x'>hi</p>");

  assert.equal(html, "<p>&lt;p class=&#39;x&#39;&gt;hi&lt;/p&gt;</p>");
});

test("escapes html inside headings, list items and quotes", () => {
  const html = renderMarkdown("# <b>a</b>\n\n- <i>b</i>\n\n> <svg onload=alert(1)>");

  assert.equal(
    html,
    '<h1 id="a">&lt;b&gt;a&lt;/b&gt;</h1>\n<ul><li>&lt;i&gt;b&lt;/i&gt;</li></ul>\n' +
      "<blockquote><p>&lt;svg onload=alert(1)&gt;</p></blockquote>"
  );
});

test("never emits a raw script or event handler tag", () => {
  const samples = [
    "<script>alert(1)</script>",
    "# <script>alert(1)</script>",
    "- <script>alert(1)</script>",
    "> <script>alert(1)</script>",
    "[a](https://x.com) <script>alert(1)</script>",
    "**<script>alert(1)</script>**",
    "`<script>alert(1)</script>`",
    "~~~html\n<script>alert(1)</script>\n~~~",
    "    <script>alert(1)</script>"
  ];

  for (const sample of samples) {
    const html = renderMarkdown(sample);
    assert.doesNotMatch(html, /<script/i, `sample: ${sample}`);
    assert.doesNotMatch(html, /\son\w+=/i, `sample: ${sample}`);
  }
});

test("strips control characters and forged token placeholders", () => {
  const html = renderMarkdown("a\u0000b\uE0000\uE001 *bold*");

  assert.equal(html, "<p>ab0 <em>bold</em></p>");
});

test("renders tilde fenced code blocks", () => {
  assert.equal(renderMarkdown("~~~\nplain block\n~~~"), "<pre><code>plain block</code></pre>");
  assert.equal(
    renderMarkdown("~~~~\nlonger fence\n~~~~"),
    "<pre><code>longer fence</code></pre>"
  );
});

test("keeps a different fence marker literal inside a code block", () => {
  assert.equal(
    renderMarkdown("```\n~~~\nliteral\n~~~\n```"),
    "<pre><code>~~~\nliteral\n~~~</code></pre>"
  );
});

test("renders indented code blocks and keeps consecutive blocks together", () => {
  assert.equal(
    renderMarkdown("    first\n    second\n\nafter"),
    "<pre><code>first\nsecond</code></pre>\n<p>after</p>"
  );
  assert.equal(
    renderMarkdown("    one\n\n    two"),
    "<pre><code>one\n\ntwo</code></pre>"
  );
});

test("does not turn indented paragraph continuations into code", () => {
  assert.equal(renderMarkdown("line one\n    line two"), "<p>line one\n    line two</p>");
});

test("renders code spans delimited by longer backtick runs", () => {
  assert.equal(renderMarkdown("`` a ` b ``"), "<p><code>a ` b</code></p>");
  assert.equal(renderMarkdown("`inline`"), "<p><code>inline</code></p>");
});

test("renders GFM tables with alignment", () => {
  const html = renderMarkdown([
    "| Feature | State | Notes |",
    "| :--- | :---: | ---: |",
    "| Upload | done | local |",
    "| Paste | done | clipboard |"
  ].join("\n"));

  assert.equal(
    html,
    "<table><thead><tr>" +
      '<th class="align-left">Feature</th>' +
      '<th class="align-center">State</th>' +
      '<th class="align-right">Notes</th>' +
      "</tr></thead><tbody>" +
      '<tr><td class="align-left">Upload</td><td class="align-center">done</td><td class="align-right">local</td></tr>' +
      '<tr><td class="align-left">Paste</td><td class="align-center">done</td><td class="align-right">clipboard</td></tr>' +
      "</tbody></table>"
  );
});

test("formats inline markdown inside table cells", () => {
  const html = renderMarkdown("| A | B |\n| --- | --- |\n| **bold** | `code` |");

  assert.match(html, /<td><strong>bold<\/strong><\/td>/);
  assert.match(html, /<td><code>code<\/code><\/td>/);
});

test("renders tables without outer pipes and stops at a blank line", () => {
  const html = renderMarkdown("A | B\n--- | ---\n1 | 2\n\nafter");

  assert.match(html, /<table>[\s\S]*<\/table>/);
  assert.match(html, /<\/table>\n<p>after<\/p>$/);
});

test("escapes html inside table cells", () => {
  const html = renderMarkdown('| A |\n| --- |\n| <img src=x onerror="alert(1)"> |');

  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});

test("does not treat pipes without a divider row as a table", () => {
  assert.equal(renderMarkdown("| a | b |"), "<p>| a | b |</p>");
  assert.equal(renderMarkdown("| a | b |\n| --- |"), "<p>| a | b |\n| --- |</p>");
});

test("renders task list items as disabled checkboxes", () => {
  const html = renderMarkdown("- [x] Done\n- [ ] Todo\n- Plain");

  assert.match(html, /<li class="task-item"><input class="task-checkbox" type="checkbox" disabled checked> Done<\/li>/);
  assert.match(html, /<li class="task-item"><input class="task-checkbox" type="checkbox" disabled> Todo<\/li>/);
  assert.match(html, /<li>Plain<\/li>/);
});

test("formats markdown inside task list items", () => {
  const html = renderMarkdown("- [x] **Bold** task with `code`");

  assert.match(html, /<strong>Bold<\/strong> task with <code>code<\/code>/);
});

test("keeps ordered task lists working", () => {
  const html = renderMarkdown("1. [x] first\n2. [ ] second");

  assert.match(html, /^<ol>/);
  assert.match(html, /<li class="task-item">/);
});

test("does not emit handlers or scripts in task lists and tables", () => {
  const html = renderMarkdown('- [x] <script>alert("1")</script>\n\n| A |\n| --- |\n| <svg onload="alert(1)"> |');

  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<svg/i);
  assert.doesNotMatch(html, /\son\w+=(?!&quot;)/i);
});
