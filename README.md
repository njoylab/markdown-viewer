# Markdown Viewer Repo

Small browser app used as a target repository for the GitHub issue bugfix agent.

## Run

```bash
npm run dev
```

Open `http://127.0.0.1:3000`, upload a `.md` file and preview formatted Markdown.

## Features

- Drag-and-drop a `.md`, `.markdown` or `.txt` file anywhere on the page, or upload it with the button.
- Paste Markdown from the clipboard with `Ctrl+V` / `Cmd+V`.
- Edit a loaded document with the pencil button; click it again to return to the updated preview. Changes are kept in the browser session, without modifying the original file. Shared documents can be edited too; copy a new share link to keep those changes without replacing the saved local document.
- YAML frontmatter is parsed and shown as a metadata card with title, tag badges and key/value fields.
- GitHub-flavoured tables with column alignment and task lists with checkboxes.
- Syntax highlighting for fenced code blocks (JavaScript/TypeScript, JSON, CSS, HTML, shell, Python).
- Dark/light mode toggle with system preference detection, persisted in `localStorage`.
- Outline navigation built from the `h2`/`h3` headings, with the current section highlighted while scrolling.
- Deep links: every heading gets a stable `#id` anchor, so a section can be shared and restored on reload.
- Export: copy the rendered HTML to the clipboard, or print / save as PDF with a dedicated print stylesheet.
- The last loaded document is restored from `localStorage` on reload; **Clear** empties it.
- Four text sizes (`A-` / `A+`) persisted in `localStorage`, applied before the first paint.
- Keyboard shortcuts, listed in the "Keyboard shortcuts" panel: `T` theme, `O` outline, `+`/`-` text size, `C` copy HTML, `P` print, `Esc` close the outline.
- Links are sanitized through an explicit allow list (`http`, `https`, `mailto`, `tel` and relative urls); anything else stays as plain text.

Everything runs in the browser with no dependencies: `src/markdown.js` parses Markdown, `src/highlight.js` highlights code, `src/frontmatter.js` reads metadata, `src/toc.js` builds the outline, `src/sanitize.js` filters urls, `src/session.js` persists the document and `src/theme.js` handles the colour theme.

## Checks

```bash
npm run lint
npm test
```

The agent can infer these commands from `package.json`, so a config does not need explicit `lintCommand` or `testCommand`.

## E2E

```bash
npm install
npx playwright install chromium
npm run test:e2e
```

## E2E Fixture

Use `test/fixtures/sample.md` as the upload file for browser/e2e checks.
