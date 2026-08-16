# Roadmap

Logged, not built.

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

## Narration cleanup: filler words and mid-clip silences

Leading/trailing silence is already trimmed (RMS bounds stored beside the
take). The next level — cutting "um"s and long mid-clip pauses — needs models:

- **Silero VAD** for mid-clip silence segmentation: ~2 MB ONNX, runs in the
  browser via onnxruntime-web, purpose-built for speech/non-speech boundaries.
  Cut or compress the non-speech gaps it finds.
- **CrisperWhisper** (or whisper-timestamped) for filler words: verbatim ASR
  with word-level timestamps that *keeps* disfluencies. Important gotcha:
  standard Whisper models deliberately omit "um/uh" from transcripts, so they
  can't locate what they don't emit — verbatim variants are the point.
- Cutting audio requires re-encoding (browsers decode opus but don't encode
  it); either accept WAV output or do the splice server-side with ffmpeg in
  the dev middleware.

AI-gated: model-driven, so it waits behind the same review gate as the
assistant below.

## Word-accurate narration highlight (forced alignment)

Today's playback highlight estimates timing by spreading the clip across the
words by character count. The accurate version is forced alignment, and it's
easier than general transcription because the target text is already known:

- Run a small on-device STT over each take — **Moonshine tiny/base**
  (27M/61M, built for browser/edge, faster than whisper-tiny) or
  **whisper-tiny/base via Transformers.js** (`return_timestamps: 'word'`),
  or **Vosk WASM** (word timestamps native).
- Align the (imperfect) transcript to the known section text with dynamic
  time warping / edit-distance matching; store per-word timestamps in the
  take's meta beside the trim bounds.
- Fits the AI constraints: read-only, on-device, never writes content — but
  it's still model-driven, so it waits behind the review gate.

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
