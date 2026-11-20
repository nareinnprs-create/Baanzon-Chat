#!/usr/bin/env bash
# Installs the Diya voice sidecar on the pod: python deps + models.
# Idempotent - existing models/caches are kept. Safe to re-run after a release.
set -euo pipefail

MODELS_DIR="${VOICE_MODELS_DIR:-/workspace/models}"
mkdir -p "$MODELS_DIR"

echo "[voice-tts] python deps (cpu torch)"
pip3 install --quiet --disable-pip-version-check \
  --index-url https://download.pytorch.org/whl/cpu torch
# Mismatched GPU builds of torchvision/torchaudio break transformers' imports
# on this CPU-only pod (torchvision::nms missing); they are not used here.
pip3 uninstall -y -q torchvision torchaudio >/dev/null 2>&1 || true
pip3 install --quiet --disable-pip-version-check -r "$(dirname "$0")/requirements.txt"
# espeak-ng backs Kokoro's phonemizer (English especially).
if ! command -v espeak-ng >/dev/null 2>&1; then
  apt-get install -y -qq espeak-ng libespeak-ng1 >/dev/null 2>&1 || true
fi

fetch() {
  local url="$1" target="$2"
  if [ -s "$target" ]; then
    echo "[voice-tts] keep $(basename "$target")"
    return 0
  fi
  echo "[voice-tts] fetch $(basename "$target")"
  curl -fsSL --retry 3 -o "$target.part" "$url"
  mv "$target.part" "$target"
}

# Kokoro-82M (natural female voices: en, hi, es, fr, it, pt, ja, zh)
fetch "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx" "$MODELS_DIR/kokoro-v1.0.onnx"
fetch "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin" "$MODELS_DIR/voices-v1.0.bin"

# Meta MMS VITS models for the Indic languages Kokoro lacks. Prefetch into the
# HF cache so the first user request never waits on a download.
echo "[voice-tts] prefetching MMS Indic voices"
python3 - <<'PY'
from transformers import AutoTokenizer, VitsModel

for code in ["tam", "tel", "ben", "guj", "kan", "mal", "pan", "ory", "asm", "mar", "urd"]:
    name = f"facebook/mms-tts-{code}"
    try:
        VitsModel.from_pretrained(name)
        AutoTokenizer.from_pretrained(name)
        print(f"[voice-tts] keep {name}")
    except Exception as error:  # noqa: BLE001 - a missing voice degrades to the next provider
        print(f"[voice-tts] WARN {name}: {error}")
PY

echo "[voice-tts] models ready in $MODELS_DIR"
