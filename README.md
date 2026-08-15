# selfdoc

A document that edits itself.

![Edit mode: click a paragraph and type](docs/edit-mode.png)

Content lives in MDX files. The rendered page — typography, callouts, stat
rows, margin notes, whatever components you add — doubles as the editor: toggle
edit mode, click any paragraph, type, click away. The edit is converted back to
markdown and spliced into the `.mdx` source at the exact character range the
block came from. No database, no CMS, no admin panel. `git diff` is the audit
log.

## Run it

```sh
pnpm install
pnpm dev
```

- **✏️ Edit** (bottom right) — click a block to rewrite it; hover a block for
  the toolbar: **+ ¶** add paragraph, **+ note** add margin note, **✕** delete
  (components too).
- **💬 Comment** — click a block to annotate it. Comments are reader-state in
  localStorage, shown as amber dots; they never touch the file.
- **Progress ring** (bottom left) — reading progress; click it for a table of
  contents with per-section reading times. A `<Toc />` component renders the
  same thing inline.
- **Citations** — standard markdown footnotes (`[^id]`), rendered as endnotes.
  Refs round-trip through inline edits; you can even type a new `[^ref]` into a
  paragraph and add its definition in the file.
- **Multiple docs** — every `content/*.mdx` gets a topbar link
  (`?doc=colophon`). Side-by-side: `?compare=doc,colophon`.

## Share it

```sh
pnpm export   # dist/index.html — one self-contained file
```

The export inlines all docs, the reading chrome, and commenting into a single
HTML file that works from `file://`. Editing is dev-only and excluded.

## How it works

1. **`plugins/rehype-source-pos.mjs`** — the markdown compiler already knows
   the character offsets of every block in the source file. This rehype plugin
   stamps them onto prose blocks as `data-edit-start`/`end` (text-editable) and
   onto JSX components as `data-node-start`/`end` (removable as a unit; their
   prose children stay editable). Nested blocks are skipped so ranges never
   overlap; the generated endnotes section is skipped because HTML→markdown
   has no footnote syntax to round-trip through.
2. **`src/editor-core.js`** — clicking a stamped block makes it
   `contentEditable`. On blur, [turndown](https://github.com/mixmark-io/turndown)
   converts the edited HTML back to markdown (custom rule so citation refs
   come back as `[^id]`; `{` and `<` escaped outside code so a stray brace
   can't break the MDX compile) and POSTs it with the block's range.
   Insertion is the same splice with `start == end`.
3. **`vite.config.mjs`** — a dev-only middleware (`/__save`) splices the
   replacement into the file at that range, allowlisted to `content/*.mdx`.
   The page reloads with fresh offsets.

The reading chrome (`src/chrome.jsx`) is derived from the rendered DOM after
mount — TOC, per-section durations, progress — so it's never stored and can't
conflict with editing. Comments (`src/comments.js`) anchor to a hash of each
block's text: stable across edits elsewhere, orphaned if the block itself is
rewritten.

## The boundary that makes it sane

- **Prose** (paragraphs, headings, lists, quotes) → edit in the page.
- **Structure** (components, their props, document order beyond
  add/delete-after) → edit in the MDX file, where structure belongs.
- **Reader state** (comments) → localStorage, never the file.

## Known limits

- Component props (a stat's `value`, a callout's `title`) aren't inline-editable
  yet. The natural extension: an `<Editable prop="title">` wrapper that patches
  the JSX attribute the same way.
- Tables and the endnotes section render but are file-edited — their
  HTML→markdown conversion isn't trustworthy enough to write back.
- Round-tripping normalizes formatting: source line-wrapping collapses to one
  line per paragraph on first edit; exotic pasted HTML becomes whatever
  turndown makes of it.
- Comments on a block are orphaned if that block's text is rewritten.

## Prior art

- **TiddlyWiki** — the original "quine" wiki: a single HTML file that edits and
  re-saves itself. Spiritual ancestor.
- **TinaCMS** — the productized version of this idea (visual MDX editing,
  git-backed). The off-ramp if this pattern needs multi-user editing.
- **Tufte CSS** — the margin-note tradition the `<Note>` component borrows.
- **Obsidian / Typora** — live-preview markdown editors; same instinct,
  different direction (editor that renders vs. render that edits).
