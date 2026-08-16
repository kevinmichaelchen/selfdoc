# Voice cloning: how it works, and how much voice is enough

selfdoc clones the author's voice with [Kyutai Pocket TTS](https://github.com/kyutai-labs/pocket-tts)
(100M params, CPU-friendly, MIT code / gated weights) so synthetic fill for
unread sections can speak *approximately as the author* — still always marked
synthetic. The reference audio comes from the recordings the author already
made: selfdoc's whole narration ritual doubles as cloning material.

## The pipeline

1. **Reference** — the Voice panel assembles ~20s of the author's cleanest
   speech client-side: real (non-synthetic) takes, trim bounds applied,
   pause-skips cut out, resampled to Pocket's native 24 kHz mono, saved to
   `content/voice/reference.wav` with a manifest of which takes built it.
2. **Worker** — the dev middleware spawns `scripts/pocket_worker.py` (via
   `uv run --with pocket-tts`), which loads the model and derives the voice
   state once, then serves synthesis over JSON lines. Both loads are slow;
   the worker stays warm between requests. Rebuilding the reference restarts
   it.
3. **Takes** — synthesized wav comes back to the browser and goes through
   the exact pipeline of every other take: silence-trim, 32 kbps opus,
   `tts: {model: "Pocket TTS", voice: "cloned from your takes"}` in meta.
   Readers and exports never touch a model.

One-time setup: the cloning weights are gated — accept the terms at
[huggingface.co/kyutai/pocket-tts](https://huggingface.co/kyutai/pocket-tts),
then `uvx hf auth login`. Without that, only Kyutai's catalog voices work.

## Does more reference audio make a better clone?

Yes — but only briefly. For zero-shot cloning (an embedding/state derived
from a prompt, no fine-tuning), the research consensus is a fast plateau:

- **~6–10 seconds** of clean speech captures the core identity of a voice
  (a dedicated study on reference-duration found this range sufficient for
  core characteristics).
- **10 → 20 seconds** still buys notable improvement in stability and
  prosody.
- **Beyond ~20–30 seconds, gains are minor.** Several systems even degrade
  on very long prompts; NVIDIA's zero-shot TTS documentation warns that
  prompts over ~10s can *lower* quality for their model, and Pocket TTS
  offers `truncate` at 30s to cap memory.

That's why selfdoc targets **20 seconds** (capped at 28) and spends its
budget on *cleanliness* rather than length: trimmed spans only, dead air and
long pauses cut, because — per Kyutai's own guidance — "the audio quality of
the sample is also reproduced." A clean 15 seconds beats a raspy minute.

What longer recording genuinely buys is not identity but *range*: a 60-second
sample still won't cover the emotional range a voice has, and no zero-shot
clone reaches "essentially perfect." That last stretch is fine-tuning
territory (minutes-to-hours of audio, actual training), which is out of
scope for a doc tool.

## Is there an optimal set of sentences?

There's a well-studied answer from speech science: **phonetically balanced
material** — text chosen so the phoneme distribution matches natural English.
The classics:

- **Harvard/IEEE sentences** — 72 lists of 10 short sentences, each list
  phonetically balanced ("Oak is strong and also gives shade.").
- **The Rainbow Passage** — a ~330-word paragraph long used in speech
  pathology precisely because it contains nearly all English phoneme
  transitions; the first ~6 sentences (~30s read aloud) cover most of it.

For a zero-shot state like Pocket's, phonetic coverage matters less than for
training a model — the state mostly captures timbre and prosody — but variety
still helps: a reference built from one monotone paragraph clones a monotone.
Practical recipe, in order of impact:

1. **Clean recording** (quiet room, steady mic distance) — dominates
   everything else.
2. **Natural, varied prose** at your normal reading pace — which selfdoc's
   takes already are; assembling segments from *different sections* adds
   variety for free.
3. **~20 seconds total** — the plateau point.
4. If you want a purpose-made reference instead, read the first paragraph of
   the Rainbow Passage once, cleanly. That's the "optimal sentences" answer
   in one sentence.

## Sources

- [Zhu, Zero-Shot Voice Cloning with Minimal Data (RUG thesis)](https://campus-fryslan.studenttheses.ub.rug.nl/708/1/MAs5965055QYZhu.pdf) — the 6–10s core / ~20s plateau finding
- [NVIDIA Speech NIM: voice cloning docs](https://docs.nvidia.com/nim/speech/latest/tts/voice-cloning.html) — 3–10s guidance, long-prompt degradation
- [Voice Cloning: Comprehensive Survey (arXiv 2505.00579)](https://arxiv.org/html/2505.00579v1)
- [Pocket TTS repo](https://github.com/kyutai-labs/pocket-tts) and [docs](https://kyutai-labs.github.io/pocket-tts/) — API, gating, "sample quality is reproduced"
