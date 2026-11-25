#!/usr/bin/env python3
"""
Baanzon Diya voice sidecar.

One fixed female voice per language, served as WAV over a tiny HTTP API so the
web app only ever plays audio bytes - device voices and browser locales can
never change what users hear.

Engines:
  kokoro  - Kokoro-82M ONNX (natural female voices: en, hi, es, fr, it, pt, ja, zh)
  mms     - Meta MMS VITS ONNX (remaining Indic: ta, te, bn, gu, kn, ml, pa, or, as)

Run:  python3 server.py --port 8471 --models /workspace/models
API:  GET  /health                -> {"ok": true, "engines": [...]}
      POST /tts {"text", "lang"}  -> audio/wav (mono, 22.05k/16k)
"""
import argparse
import collections
import io
import json
import os
import sys
import threading
import wave

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# The pod shares a host with many cores but is capped at a couple of vCPUs.
# onnxruntime otherwise sizes its thread pool from /proc/cpuinfo and thrashes
# (one request can take a minute instead of seconds).
CPU_THREADS = max(1, min(4, len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else 2))
os.environ.setdefault("OMP_NUM_THREADS", str(CPU_THREADS))
os.environ.setdefault("MKL_NUM_THREADS", str(CPU_THREADS))

import numpy as np
import onnxruntime as ort

_ORT_SESSION = ort.InferenceSession


def _limited_session(path, sess_options=None, **kwargs):
    """Every session in this process (Kokoro included) gets a small pool."""
    options = sess_options or ort.SessionOptions()
    options.intra_op_num_threads = CPU_THREADS
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    return _ORT_SESSION(path, options, **kwargs)


ort.InferenceSession = _limited_session

MODELS = os.environ.get("VOICE_MODELS_DIR", "/workspace/models")

# Fixed female voice per language. Kokoro voice ids are stable; MMS repos are
# Xenova ONNX exports of facebook/mms-tts-<code>.
KOKORO_VOICES = {
    "en": "af_heart",
    "hi": "hf_alpha",
    "es": "ef_dora",
    "fr": "ff_siwis",
    "it": "if_sara",
    "pt": "pf_dora",
    "ja": "jf_alpha",
    "zh": "zf_xiaobei",
}

# Kokoro expects full locale codes; the API speaks two-letter codes.
KOKORO_LOCALES = {
    "en": "en-us",
    "hi": "hi",
    "es": "es",
    "fr": "fr-fr",
    "it": "it",
    "pt": "pt-br",
    "ja": "ja",
    "zh": "zh",
}
MMS_LANGS = {
    "ta": "tam",
    "te": "tel",
    "bn": "ben",
    "gu": "guj",
    "kn": "kan",
    "ml": "mal",
    "pa": "pan",
    "or": "ory",
    "as": "asm",
    "mr": "mar",
    # Meta publishes Urdu per script; Arabic is the written form users expect.
    "ur": "urd-script_arabic",
    "mai": "mai",
}

_lock = threading.Lock()
_kokoro = None
_kokoro_voices = None
_mms_cache = {}
# Ordered so the oldest synthesis is evicted first; ~64 short clips of audio.
_cache = collections.OrderedDict()
_CACHE_MAX = 64


def log(message):
    print(f"[voice-tts] {message}", flush=True)


def load_kokoro():
    global _kokoro, _kokoro_voices
    if _kokoro is not None:
        return _kokoro, _kokoro_voices
    from kokoro_onnx import Kokoro

    model_path = os.path.join(MODELS, "kokoro-v1.0.onnx")
    voices_path = os.path.join(MODELS, "voices-v1.0.bin")
    if not os.path.exists(model_path) or not os.path.exists(voices_path):
        raise RuntimeError("kokoro models missing")
    _kokoro = Kokoro(model_path, voices_path)
    _kokoro_voices = set(KOKORO_VOICES.values())
    log("kokoro loaded")
    return _kokoro, _kokoro_voices


def load_mms(code):
    if code in _mms_cache:
        return _mms_cache[code]
    from transformers import AutoTokenizer, VitsModel

    model_name = f"facebook/mms-tts-{code}"
    model = VitsModel.from_pretrained(model_name)
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    # Keep at most two MMS models resident; each is small but the pod is shared.
    if len(_mms_cache) >= 2:
        _mms_cache.pop(next(iter(_mms_cache)))
    _mms_cache[code] = (model, tokenizer)
    log(f"mms {code} loaded")
    return _mms_cache[code]


def kokoro_wav(text, lang):
    kokoro, voices = load_kokoro()
    voice = KOKORO_VOICES[lang]
    if voice not in voices:
        raise RuntimeError(f"kokoro voice {voice} missing")
    samples, sample_rate = kokoro.create(text, voice=voice, speed=1.0, lang=KOKORO_LOCALES[lang])
    return to_wav(samples, sample_rate)


def mms_wav(text, lang):
    import torch

    # Torch sizes its pool from the host too; cap it like onnxruntime.
    torch.set_num_threads(CPU_THREADS)
    code = MMS_LANGS[lang]
    model, tokenizer = load_mms(code)
    inputs = tokenizer(text, return_tensors="pt")
    with torch.no_grad():
        waveform = model(**inputs).waveform
    samples = np.asarray(waveform.squeeze().numpy(), dtype=np.float32)
    return to_wav(samples, int(model.config.sampling_rate))


def to_wav(samples, sample_rate):
    samples = np.asarray(samples, dtype=np.float32)
    peak = float(np.max(np.abs(samples))) or 1.0
    if peak > 1.0:
        samples = samples / peak
    pcm = (samples * 32767.0).astype(np.int16)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(int(sample_rate))
        handle.writeframes(pcm.tobytes())
    return buffer.getvalue()


def _normalize_lang(lang):
    """`mai` and `urd-script_arabic` are valid codes; do not blind-truncate."""
    code = (lang or "en").lower().strip()
    base = code.replace("_", "-").split("-")[0]
    if base in KOKORO_VOICES or base in MMS_LANGS:
        return base
    return base[:2]


def synthesize(text, lang):
    lang = _normalize_lang(lang)
    key = (lang, text)
    with _lock:
        cached = _cache.get(key)
        if cached is not None:
            _cache.move_to_end(key)
            return cached
        if lang in KOKORO_VOICES:
            result = (kokoro_wav(text, lang), "kokoro")
        elif lang in MMS_LANGS:
            result = (mms_wav(text, lang), "mms")
        else:
            raise ValueError(f"unsupported language: {lang}")
        # Sentence-level cache: the greeting and the common replies repeat across
        # turns and users, and synthesis is the slow part on this pod.
        _cache[key] = result
        while len(_cache) > _CACHE_MAX:
            _cache.popitem(last=False)
        return result


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write(f"[voice-tts] {fmt % args}\n")

    def _json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"ok": True, "engines": ["kokoro", "mms"]})
        return self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/tts":
            return self._json(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            text = str(payload.get("text", "")).strip()
            lang = str(payload.get("lang", "en"))
            if not text:
                return self._json(400, {"error": "text is required"})
            if len(text) > 1200:
                text = text[:1200]
            audio, engine = synthesize(text, lang)
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("X-Voice-Engine", engine)
            self.send_header("Content-Length", str(len(audio)))
            self.end_headers()
            self.wfile.write(audio)
        except ValueError as error:
            return self._json(400, {"error": str(error)})
        except Exception as error:  # noqa: BLE001 - report, never crash the server
            log(f"synthesis failed: {error}")
            return self._json(500, {"error": str(error)})


def warmup():
    """Load the engines before the first caller arrives.

    A cold Kokoro or MMS load takes tens of seconds on this pod; doing it on the
    first request made that user wait (and could exceed the API's 60s budget).
    Runs off the request path and never crashes the server.
    """
    try:
        load_kokoro()
        log("warmup: kokoro ready")
    except Exception as error:  # noqa: BLE001 - a missing model degrades, never crashes
        log(f"warmup: kokoro unavailable ({error})")
    # The Indic languages Kokoro lacks; the three most common first. Load the
    # models only: synthesizing a Latin word makes some MMS tokenizers produce
    # an empty sequence, which is a tokenizer quirk, not a failed load.
    for lang in ("ta", "te", "bn", "ml", "kn"):
        try:
            load_mms(MMS_LANGS[lang])
            log(f"warmup: mms {lang} ready")
        except Exception as error:  # noqa: BLE001
            log(f"warmup: mms {lang} unavailable ({error})")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8471)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    log(f"listening on 127.0.0.1:{args.port} models={MODELS}")
    threading.Thread(target=warmup, name="warmup", daemon=True).start()
    server.serve_forever()


if __name__ == "__main__":
    main()
