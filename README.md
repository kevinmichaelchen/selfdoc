# selfdoc

A document that edits itself.

![Edit mode: click a paragraph and type](docs/edit-mode.png)

The content lives in one MDX file. The rendered page — typography, callouts,
stat rows, whatever components you add — doubles as the editor: toggle edit
mode, click any paragraph, type, click away. The edit is converted back to
markdown and spliced into the `.mdx` source at the exact character range the
block came from. No database, no CMS, no admin panel. `git diff` is the audit
log.

## Run it

```sh
pnpm install
pnpm dev
```

Open the page, hit **Edit this page** (bottom right), click a paragraph, edit,
click away. Then look at `content/doc.mdx` — your edit is in the file.

## How it works

Three small pieces, ~300 lines total:

1. **`plugins/rehype-source-pos.mjs`** — the markdown compiler already knows
   the character offsets of every block in the source file. This rehype plugin
   stamps them onto rendered elements as `data-edit-start` / `data-edit-end`.
   Nested blocks are skipped so editable regions never overlap.
2. **`src/editor.jsx`** — in edit mode, clicking a stamped block makes it
   `contentEditable`. On blur, [turndown](https://github.com/mixmark-io/turndown)
   converts the edited HTML back to markdown (with `{` and `<` escaped outside
   code, so a stray brace can't break the MDX compile) and POSTs it with the
   block's range.
3. **`vite.config.mjs`** — a dev-only middleware (`/__save`) splices the
   replacement into the file at that range. Vite notices the file change,
   recompiles, and reloads the page with fresh offsets.

The editing loop only exists under `pnpm dev`; `pnpm build` produces a plain
static site with no editor.

## The boundary that makes it sane

- **Prose** (paragraphs, headings, lists, quotes) → edit in the page.
- **Structure** (components, their props, document order) → edit in the MDX
  file, where structure belongs.

Text nested *inside* a component's children is still prose, so it's still
click-to-edit.

## Known limits

- Component props (a stat's `value`, a callout's `title`) aren't inline-editable
  yet. The natural extension: components render their props through a small
  `<Editable prop="title">` wrapper that PATCHes the JSX attribute the same way.
- Round-tripping is only as good as HTML→markdown conversion. Bold, italics,
  links, inline code, and lists survive cleanly; exotic pasted HTML gets
  normalized to whatever turndown makes of it.
- One document per repo for now. Multi-doc is just a route param plus an
  allowlist in the save middleware.

## Prior art

- **TiddlyWiki** — the original "quine" wiki: a single HTML file that edits and
  re-saves itself. Spiritual ancestor.
- **TinaCMS** — the productized version of this idea (visual MDX editing,
  git-backed). Worth adopting if this pattern earns real usage.
- **Obsidian / Typora** — live-preview markdown editors; same instinct,
  different direction (editor that renders vs. render that edits).
