# Roadmap

Logged, not built.

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
