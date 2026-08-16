"""Long-lived Pocket TTS worker for the dev middleware.

Loads the model and the author's voice state once (both are slow), then
serves JSON-line requests on stdin: {"text": ..., "out": "/path.wav"} ->
{"ok": "/path.wav"}. Spawned by vite.config.mjs, never run by readers.

Usage: python pocket_worker.py <reference.wav | catalog voice name>

Voice cloning from a wav needs the gated weights: accept the terms at
https://huggingface.co/kyutai/pocket-tts, then `uvx hf auth login`.
"""

import json
import sys
import wave

import numpy as np


def main() -> None:
    voice = sys.argv[1]
    try:
        from pocket_tts import TTSModel

        model = TTSModel.load_model()
        voice_state = model.get_state_for_audio_prompt(voice, truncate=True)
    except Exception as err:
        print(json.dumps({"fatal": str(err)[:500]}), flush=True)
        raise SystemExit(1)
    print(json.dumps({"ready": True}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            audio = model.generate_audio(voice_state, request["text"])
            pcm = np.clip(np.asarray(audio).reshape(-1), -1.0, 1.0)
            data = (pcm * 32767).astype("<i2")
            with wave.open(request["out"], "wb") as out:
                out.setnchannels(1)
                out.setsampwidth(2)
                out.setframerate(model.sample_rate)
                out.writeframes(data.tobytes())
            print(json.dumps({"ok": request["out"]}), flush=True)
        except Exception as err:  # keep serving; the middleware maps this to a 502
            print(json.dumps({"error": str(err)[:300]}), flush=True)


if __name__ == "__main__":
    main()
