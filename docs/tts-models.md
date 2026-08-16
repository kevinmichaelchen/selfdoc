# TTS model landscape for selfdoc

Researched 2026-08-15 against live HuggingFace/GitHub pages. Context: listen
mode is the default way into a doc; human takes are canonical; TTS would fill
unrecorded sections, always visibly marked synthetic.

## The architecture question first

Two ways to use TTS, and they're very different:

- **Author-side render (recommended).** TTS runs once, on the author's
  machine in dev — the same pattern as whisper alignment. Output is saved as
  ordinary takes (flagged `tts` in meta), travels in exports as audio,
  and readers never load a model. Any tier below works, because the author
  picks one machine.
- **Reader-side synthesis.** The reader's browser generates speech on demand.
  Only the browser tier works, every reader pays the model download, and
  export single-files can't carry the model. Only worth it if we don't want
  synthetic audio committed to the repo.

## Browser tier (runs in the page: WebGPU / WASM)

| Model | Params | Disk | Type | License | Notes |
| --- | --- | --- | --- | --- | --- |
| [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) ([gh](https://github.com/hexgrad/kokoro)) | 82M | 86–326 MB (q8f16 = 86 MB) | StyleTTS2-class | Apache-2.0 | Best quality-per-MB; `kokoro-js` npm, WebGPU or WASM, streaming; EN-focused; needs phonemizer; former #1 on TTS Arena |
| [KittenTTS nano](https://github.com/KittenML/KittenTTS) ([onnx](https://huggingface.co/onnx-community/kitten-tts-nano-0.1-ONNX)) | 15M | 24–25 MB | lightweight ONNX (StyleTTS2 family) | Apache-2.0 | Smallest credible option; runs in plain WASM; built-in number/date normalization; EN only, "developer preview" |
| [Supertonic 3](https://github.com/supertone-inc/supertonic) ([hf](https://huggingface.co/Supertone/supertonic-3)) | ~99M | ~410 MB fp32 | flow matching, 2-step | code MIT, weights **OpenRAIL-M** | 60–150× realtime on WebGPU; 31 languages; handles numbers/dates/currency with no preprocessing; repo warns it may be archived — watch for successor |
| [Piper (piper1-gpl)](https://github.com/OHF-Voice/piper1-gpl) ([voices](https://huggingface.co/rhasspy/piper-voices)) | per-voice VITS | 20–100 MB/voice | VITS | old code MIT, new **GPL-3.0**, per-voice licenses | 30+ languages, hundreds of voices; `@mintplex-labs/piper-tts-web`; workmanlike quality |
| [Kyutai Pocket TTS](https://huggingface.co/kyutai/pocket-tts) ([gh](https://github.com/kyutai-labs/pocket-tts)) | 100M | ~220 MB/language | streaming codec TTS | code MIT, weights CC-BY-4.0 | Jan 2026; 6× realtime on 2 cores of an M4 Air, ~200 ms first chunk; voice cloning; browser story emerging (native CPU first) |

## Local CPU tier (author's machine, no GPU required)

| Model | Params | Disk | Type | License | Notes |
| --- | --- | --- | --- | --- | --- |
| [Kyutai Pocket TTS](https://huggingface.co/kyutai/pocket-tts) | 100M | ~220 MB | streaming codec | CC-BY-4.0 | The standout CPU story; cloning from a wav — could match the author's recorded voice |
| [Chatterbox-Nano](https://huggingface.co/ResembleAI/chatterbox-nano) | 110M | (family repo 13.9 GB; nano subset) | distilled LLM-codec | MIT | 3× realtime on 8 CPU cores; paralinguistic tags; Perth watermarking built in |
| [NeuTTS-Air](https://huggingface.co/neuphonic/neutts-air) | 748M | 1.5 GB BF16 (Q4 GGUF ~0.5 GB) | Qwen-backbone codec | **NeuTTS Open License v1.0** (revenue-capped; was Apache at launch) | Runs via llama.cpp on laptops/phones; 3–15 s instant cloning; license changed post-launch — caution |

## Local GPU / Apple Silicon tier (quality renders)

| Model | Params | Disk | Type | License | Notes |
| --- | --- | --- | --- | --- | --- |
| [Chatterbox / Multilingual V3](https://huggingface.co/ResembleAI/chatterbox) ([gh](https://github.com/resemble-ai/chatterbox)) | 0.5B | ~3.2 GB/pipeline | LLM-codec (Llama + S3Gen) | MIT | Best-documented open model on TTS Arena (Elo ~1006); cloning, emotion control, 23 languages; MPS + MLX ports |
| [Qwen3-TTS-1.7B](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base) ([gh](https://github.com/QwenLM/Qwen3-TTS)) | 1.7B | 3.86 GB BF16 | LLM codec, 12 Hz | Apache-2.0 | Open since Jan 2026; 3 s cloning, streaming at ~97 ms, voice design by description; vendor WER among lowest reported |
| [Fun-CosyVoice3-0.5B](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512) | 0.5B | — | LLM + flow matching | Apache-2.0 | Bi-streaming, ~150 ms latency, 9 languages, cloning + instruction control |
| [Dia2-2B](https://huggingface.co/nari-labs/Dia2-2B) ([gh](https://github.com/nari-labs/dia)) | 2B | 7.68 GB fp32 | streaming dialogue codec | Apache-2.0 | **Emits word-level timestamps natively** — would replace our whisper alignment for synthetic sections; EN only; CUDA-oriented |
| [F5-TTS](https://github.com/SWivid/F5-TTS) ([hf](https://huggingface.co/SWivid/F5-TTS)) | ~336M | 1.35 GB | flow-matching DiT | code MIT, weights **CC-BY-NC-4.0** | Excellent cloning; MLX port for Apple Silicon; non-commercial weights |

## Ruled out, with reasons

- **XTTS-v2** — weights under Coqui CPML (non-commercial); company dead.
- **OuteTTS browser builds, OpenAudio S1-mini, Llasa** — CC-BY-NC.
- **Higgs Audio v2/v3** — custom licenses (MAU cap / non-commercial).
- **VibeVoice** — MIT but card says research-only; Microsoft pulled it once.
- **IndexTTS-2.5** — bilibili custom license.
- **MegaTTS3** — Apache but the cloning encoder is withheld (cloning requires
  ByteDance's verification queue).
- **Orpheus small variants (400M/150M)** — never shipped; only the 3B exists.
- **Parler-TTS mini** — 0.9B, dormant since 2024, no browser path.

## Picking a model per machine

There is no VRAM API on the web (deliberate privacy gap). The established
ladder, verified APIs:

1. `navigator.gpu` + `requestAdapter()` succeeds and
   `adapter.limits.maxBufferSize ≥ 256 MB` → WebGPU tier (Kokoro q8f16,
   fp16 if `adapter.features.has('shader-f16')`).
2. No WebGPU but `crossOriginIsolated` and
   `navigator.hardwareConcurrency ≥ 4` → threaded WASM tier (KittenTTS
   nano, 24 MB).
3. Neither → no TTS; narration stays human-only.
4. `navigator.deviceMemory` (Chromium-only, clamped to ≤8) refines the
   choice; a one-off timed warm-up inference is the final arbiter.

WebLLM's approach (static `vram_required_MB` per model, matched against a
trial device request) is the pattern to copy if we ever offer multiple sizes.

## Leaderboard reality check (Aug 2026)

Top of both arenas (TTS Arena V2, Artificial Analysis) is all closed models.
Best open entries: Chatterbox (best-documented, Elo ~1006), Step-Audio-EditX
(Elo ~1110, Apache per listing), Fish Audio S2 Pro (open status unverified).
Open TTS is roughly a year behind closed — good enough for narration
fallback, not a reason to skip recording yourself.
