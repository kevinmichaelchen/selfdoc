# ADR 0002 — Where cloud TTS keys live

Status: accepted 2026-08-16.

## Question

The Voice panel's cloud providers need API keys. Is it okay to store secret
keys in client-side state (localStorage)?

## Analysis

Honest answer: it's a known tradeoff, not a best practice.

- localStorage is plaintext on disk, readable by any JavaScript on the
  origin. One XSS bug — ours or any dependency's — exfiltrates the key.
  There is no HttpOnly equivalent for localStorage.
- What makes it *tolerable here*: the dev site runs on localhost, the key is
  the author's own (they only endanger their own bill), the key never
  touches git, exports, or the deployed site, and TTS keys are
  low-blast-radius (usage billing, not account takeover).
- What keeps it from being fine: "tolerable on localhost" rots into "pasted
  a key into a deployed page" the moment the pattern travels. Keys in the
  browser should be the fallback, not the design.

## Decision

**Environment-first, browser-fallback.**

1. The dev middleware (`/__tts`) resolves keys from its own process
   environment (`ELEVENLABS_API_KEY`, `FISH_API_KEY`). The browser learns
   only a boolean ("this provider is ready"), never the value. `GET /__tts`
   reports that readiness; the panel hides the key input entirely when the
   server has the key.
2. A key typed into the panel still works — it's sent per-request as an
   override and kept in localStorage — but the input labels the env route as
   the better one. This keeps the zero-setup path for someone trying a
   provider once.
3. Keys never enter git, exports, or builds. Only the dev server ever holds
   them.

## Do secretspec or varlock help?

Yes — both are exactly the "how does the env var get there without a
plaintext `.env`" answer, and because the middleware reads plain
`process.env`, supporting them cost nothing beyond two declaration files:

- **[secretspec](https://secretspec.dev)** (cachix): `secretspec.toml`
  (committed, no values) declares what the project needs; values live in a
  provider — OS keyring by default, 1Password, Vault, AWS SM.
  `secretspec set FISH_API_KEY` once, then `secretspec run -- pnpm dev`.
- **[varlock](https://varlock.dev)** (dmno): `.env.schema` (committed, no
  values) declares vars with `@sensitive`/`@required` decorators; values
  come from `.env.local`, encrypted storage, or backend plugins
  (1Password, Infisical, AWS/GCP/Azure). `varlock run -- pnpm dev`, with
  redaction of sensitive values in logs.

Both declaration files ship in the repo root. Neither tool is a dependency —
`export FISH_API_KEY=…; pnpm dev` works identically. Pick by taste:
secretspec is a single Rust binary with keyring-by-default; varlock is
npm-native and doubles as env validation.

## Rejected alternatives

- **Keys in a committed config** — obviously not; also why `.env` files are
  gitignored and not the documented path.
- **Vite `VITE_*` env exposure** — would compile the key into the client
  bundle; the opposite of the goal.
- **sessionStorage instead of localStorage** — marginally narrower window,
  same XSS exposure, worse UX; not worth keeping both code paths.
- **Reader-side keys on the deployed site** (ROADMAP "reader-side cloud
  rendering") — different threat model: the reader's own key on the
  reader's own machine calling the provider directly. If built, it must
  carry a "this costs you money, stored in your browser" affordance.
