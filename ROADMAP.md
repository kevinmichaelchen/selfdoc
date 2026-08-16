# Roadmap

Logged, not built.

## Voice-cloned synthetic fill (endorsed — next up)

Synthetic sections currently speak in a stock voice. Kyutai Pocket TTS
(100M, weights CC-BY-4.0, 6× realtime on two M4 cores) clones a voice from a
wav — and every selfdoc author with any recorded section already has
reference audio on disk. Clone from the author's real takes so synthetic
fill approximates their voice, still marked synthetic. Browser story is
emerging; may need a small native/CLI step in the dev middleware.

## Reader-side cloud rendering

The Voice panel is author-side. A reader of the deployed site could
optionally paste their own ElevenLabs/Fish key to render unread sections
on demand in their browser (direct API calls, key in their localStorage).
Needs CORS verification per provider and a clear "this costs you money"
affordance.

## Library watch (researched 2026-08-15)

Findings from a review of the new TanStack content libraries:

- **TanStack Markdown** — cannot replace our MDX pipeline: its AST carries no
  source positions (verified in `src/types.ts`; block parsing is line-based),
  and selfdoc's splice mechanism is built entirely on remark's character
  offsets. No MDX/JSX either (components are HTML-comment markers with
  string-only attributes), and no markdown serializer, so it doesn't help the
  turndown side. Ideas worth keeping: full synchronous reparse per edit as a
  legitimate architecture (validates our splice-and-recompile), and "the AST
  is the product" — a serializable parse tree we could cache between
  middleware and client.
- **TanStack Highlight** — the best candidate for code-block syntax
  highlighting when we want it: synchronous, no WASM/async init, ~4–6 kB gzip
  with a few languages, stable `th-*` semantic classes recolored by CSS-var
  themes. Wiring rule for our round-trip: highlight is a render-only overlay;
  on edit, recover source from `textContent` (the spans are pure wrappers)
  and emit the fence ourselves rather than trusting turndown with nested
  spans. Alpha (v0.0.x) — adopt when it stabilizes.
- **TanStack Charts** — pre-alpha, ~60 kB gzip whole-package against our
  ~185 kB single-file export; provenance/heat visualizations are CSS-bars
  simple for now. Revisit post-1.0 if we want brushable
  provenance-over-time timelines.
- **TanStack Hotkeys** — alpha but well-shaped (~11 kB); its tri-state rule is
  worth stealing today in hand-rolled handlers: plain-letter shortcuts ignore
  editable regions, Mod-chords and Escape fire everywhere. If we grow real
  shortcut surface (mode toggles, command palette), adopt rather than
  hand-roll further.

## Revision compare

Compare a draft of a document against its canonical version — working tree vs
`HEAD` (or a chosen ref) of the *same* doc, served by a small middleware around
`git show`, rendered in a two-pane view. Doc-to-doc comparison was cut on
purpose: there's no use case for comparing two unrelated documents.

## Reader feedback sync

Today reactions, comments, and grades are single-reader localStorage. The
multi-reader version: hash each block's content, submit annotations to a tiny
server keyed by (doc id, block hash), and render aggregate reactions and
grades in the margin in real time. Content-hash keys mean feedback survives
edits elsewhere in the doc and is automatically orphaned when the block it
judged is rewritten — same anchoring rule the local comments already use.

## Component prop editing

An `<Editable prop="title">` wrapper so a callout's title or a stat's value is
inline-editable, patching the JSX attribute through the same offset splice.

## Narration cleanup, the rest of it

Shipped (2026-08-15): long mid-clip pauses become skip ranges via RMS
segmentation (no model), and filler words the transcript reveals become skips
too — playback jumps them losslessly, no re-encoding. What remains:

- **Verbatim filler capture**: whisper-tiny deliberately omits "um/uh" from
  transcripts, so it only catches fillers it happens to emit.
  **CrisperWhisper** (verbatim ASR with word timestamps) is the upgrade when
  filler-cutting should be reliable rather than best-effort.
- **Silero VAD** (~2 MB ONNX) if RMS thresholds prove too crude for noisy
  rooms.
- Physically cutting audio (vs skip-on-playback) requires re-encoding —
  server-side ffmpeg in the dev middleware if ever needed.

## Word-accurate narration highlight — SHIPPED

Shipped (2026-08-15): after each save, whisper-tiny.en (Transformers.js,
fp32 encoder + q4 decoder — plain q8 fails to create WASM sessions) runs on
the author's machine, dev-only; the transcript is aligned onto the known
section tokens by edit-distance (substitutions donate timing, gaps
interpolate, <50% exact match rejects to the estimate), and per-word
timestamps land in the take's meta. Readers, exports, and the deployed site
consume plain timestamps — no model anywhere near them. Possible upgrades:
Moonshine tiny/base for speed, whisper-base.en for accuracy.

## Local-model reading assistant

Gated: no AI features until the foundation is solid and passes review.

Strictly read-only reading aids — the model can never write, edit, or generate
document content. Scope is dictionary-grade: define a term, locate where the
post discusses something. Hard rules: answers must cite actual sentences that
appear in the post, verified by string match before rendering (a quote that
isn't in the source is dropped); no fabrication; must say "not in this
document" when it doesn't know.

Runtime candidates (in-browser via Transformers.js / WebGPU, so the export
stays a single offline file):

- Ternary Bonsai 8B @ 1.58-bit (~2 GB)
- LiquidAI LFM2.5-350M
- NVIDIA Nemotron-3-Nano (4B)
