# ADR 0001 — Cloud TTS providers

Status: **living document** — first survey 2026-08-16. Prices and rankings in
this space move monthly; treat every number below as "verified on the survey
date," re-check before depending on one, and update this file when we learn
something new.

## Context

The Voice panel renders unread sections with a synthetic voice. Local
Kokoro-82M is free and private but audibly weaker (especially q8-on-WASM);
cloud APIs are a tier above. We currently support **ElevenLabs** and **Fish
Audio**, proxied through the dev middleware (`/__tts`) with the author's key
held only in browser localStorage. This ADR records the wider field so future
provider additions are chosen from data, not vibes.

Constraints any candidate must meet:

- Plain HTTPS request/response TTS (text in, audio bytes out) so the
  middleware proxy stays a ~20-line fetch. Streaming/websocket-only APIs are
  a poor fit — narration is batch, not conversational.
- Per-request API key (no OAuth dance).
- Output we can store as-is or trivially re-encode (mp3/opus/wav).
- Self-serve signup — an author should be able to paste a key within minutes.

## The field (surveyed 2026-08-16)

Effective cost is normalized to **US$ per 1M characters** where the provider
bills that way; ~1M chars ≈ 15–20 hours of speech.

| Provider / model | Quality signal | Pricing | Cloning | Notes |
|---|---|---|---|---|
| **Inworld TTS 1.5 (Mini/Max)** | #1–2 on Artificial Analysis & TTS Arena ELO | $25/M (Mini), $35/M (Max), PAYG | zero-shot | The current arena leader; realtime-focused but plain HTTP TTS exists. Strong add candidate. |
| **ElevenLabs** (v3 / Turbo / Flash) | Long-time top tier; closed | Subscription credits, no flat PAYG. Creator $22/mo ≈ 121k credits; 1 credit/char (v2/v3), 0.5 (Flash/Turbo) → effective ~$90–180/M at small tiers, falls with scale | yes (instant + pro) | **Implemented.** Credit math makes cost hard to predict up front. |
| **Fish Audio S1** | Top open-family vendor on arenas | **$15/M UTF-8 bytes**, pure PAYG, no minimum | yes (reference audio) | **Implemented.** Simplest honest pricing in the field. |
| **OpenAI gpt-4o-mini-tts** | Good, not arena-topping; instructable style | $0.60/M input tokens + $12/M audio tokens ≈ **$0.015/min** (~$12–15/M chars). Legacy tts-1 $15/M, tts-1-hd $30/M | no | Cheap, ubiquitous keys (many authors already have one). Strong add candidate for that reason alone. |
| **Hume Octave 2** | #6 TTS Arena; best-in-class emotional delivery | Subscription + overage $0.05–0.15 per 1k chars → ~$50–150/M | yes | "Reads for meaning" — interesting for prose narration specifically. |
| **MiniMax speech-2.6** (Turbo/HD) | #7–8 TTS Arena; 40+ languages | $60/M (Turbo), $100/M (HD) direct; cheaper via resellers (Replicate, Together) | yes | Expressive but priced above its ranking neighbors. |
| **Gradium** | Unproven — TTS in public beta; seed funding extended to $100M with NVIDIA investing | Not yet published (docs.gradium.ai) | yes (instant + professional) | Full voice platform (TTS/STT/live translation/on-device). Watch: if the beta quality matches the funding, revisit. |
| **Cartesia Sonic 3/3.5** | Fastest latency (~40ms); solid quality | Credit plans free→$299/mo, effective ~$5–37/M depending on tier; no public flat PAYG | yes (1.5 credits/char) | Latency advantage is irrelevant to batch narration. |
| **Deepgram Aura-2** | Enterprise-clean, not expressive | $30/M ($0.027 on Growth) | no | Optimized for voice agents, not long-form prose. |
| **Amazon Polly / Google Cloud / Azure** | Commodity tier — clearly below the above for prose | ~$15–16/M (neural), ~$30/M (generative/Chirp3-HD) — approximate, stable for years | limited | Cloud-console key setup violates the "paste a key in minutes" bar; skip unless an author asks. |

## Decision

1. **Fish Audio is the default cloud pick** (decided 2026-08-16): honest
   $15/M PAYG, strong arena standing, simplest onboarding. The Voice panel
   labels it recommended and auto-selects it when a `FISH_API_KEY` is in the
   server environment. **ElevenLabs** stays as the name-brand alternative.
2. Next additions, in order of appeal:
   - **OpenAI gpt-4o-mini-tts** — not the best voice, but the key many
     authors already have, at commodity price. Lowest-friction win.
   - **Inworld** — the current arena leader at mid pricing; adds a genuine
     quality ceiling above ElevenLabs.
   - **Hume Octave** — if we want narration that adapts delivery to meaning,
     which is thematically on-mission for read-your-own-prose docs.
3. Skip realtime-specialist (Cartesia, Deepgram, Rime) and cloud-console
   (Polly/Google/Azure) providers — wrong shape for batch narration or wrong
   shape for key onboarding.
4. Voice **cloning** from the author's real takes remains the endgame (see
   ROADMAP: Pocket TTS locally; ElevenLabs/Fish/MiniMax all offer cloud
   cloning if we want it sooner) — synthetic fill in the author's own voice,
   still marked synthetic.

## Sources

- [Deepgram: best TTS APIs](https://deepgram.com/learn/best-text-to-speech-apis-2026) · [FutureAGI comparison](https://futureagi.com/blog/best-text-to-speech-providers-2026/)
- [TTS Arena leaderboard](https://tts-agi-tts-arena-v2.hf.space/leaderboard) · [MarkTechPost benchmark roundup](https://www.marktechpost.com/2026/05/30/best-text-to-speech-tts-models-in-2026-a-benchmark-based-comparison/)
- [ElevenLabs pricing breakdown](https://flexprice.io/blog/elevenlabs-pricing-breakdown) · [Fish Audio developers](https://fish.audio/developers/)
- [Cartesia pricing](https://www.eesel.ai/blog/cartesia-sonic-3-pricing) · [Inworld benchmarks](https://inworld.ai/resources/best-voice-ai-tts-apis-for-real-time-voice-agents-2026-benchmarks)
- [OpenAI gpt-4o-mini-tts model page](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts) · [Hume pricing](https://www.hume.ai/pricing) · [Deepgram Aura-2](https://openrouter.ai/deepgram/aura-2) · [MiniMax pricing](https://developer.puter.com/tutorials/minimax-api-pricing/)
