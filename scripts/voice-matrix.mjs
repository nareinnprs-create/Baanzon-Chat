/**
 * P0 voice coverage harness.
 *
 * For every language the product claims, this synthesizes a sample, feeds it
 * back through Whisper (auto and hinted) and through Deepgram Nova-3
 * (multilingual streaming), and prints a per-language matrix: does TTS exist,
 * what language was detected, and how close the transcript is to the input.
 *
 * Runs on the pod, where the TTS sidecar and the provider credentials live:
 *   cd /workspace/baanzon && node scripts/voice-matrix.mjs [--skip-nova]
 *
 * It is read-only: no database writes, no app state touched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const ROOT = process.cwd();
const SIDECAR = process.env.VOICE_TTS_URL || 'http://127.0.0.1:8471';

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const text = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    const match = text.match(new RegExp(`^${name}=(.*)$`, 'm'));
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

const ACCOUNT = env('CF_ACCOUNT_ID');
const TOKEN = env('CF_API_TOKEN');
const skipNova = process.argv.includes('--skip-nova');

/** Sample sentence per language; low-resource entries are best-effort. */
const SAMPLES = {
  en: 'Hello, I am Diya. How can I help you today?',
  hi: 'नमस्ते, मैं दिया हूँ। आज मैं आपकी कैसे मदद कर सकती हूँ?',
  bn: 'নমস্কার, আমি দিয়া। আজ আমি আপনাকে কীভাবে সাহায্য করতে পারি?',
  ta: 'வணக்கம், நான் தியா. இன்று நான் உங்களுக்கு எப்படி உதவலாம்?',
  te: 'నమస్తే, నేను దియా. ఈరోజు మీకు ఎలా సహాయపడతాను?',
  mr: 'नमस्कार, मी दिया आहे. आज मी तुम्हाला कशी मदत करू शकते?',
  gu: 'નમસ્તે, હું દિયા છું. આજે હું તમને કેવી રીતે મદદ કરી શકું?',
  kn: 'ನಮಸ್ಕಾರ, ನಾನು ದಿಯಾ. ಇಂದು ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಬಹುದು?',
  ml: 'നമസ്കാരം, ഞാൻ ദിയ. ഇന്ന് ഞാൻ നിങ്ങളെ എങ്ങനെ സഹായിക്കാം?',
  pa: 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਮੈਂ ਦੀਆ ਹਾਂ। ਅੱਜ ਮੈਂ ਤੁਹਾਡੀ ਕਿਵੇਂ ਮਦਦ ਕਰ ਸਕਦੀ ਹਾਂ?',
  or: 'ନମସ୍କାର, ମୁଁ ଦିୟା। ଆଜି ମୁଁ ଆପଣଙ୍କୁ କିପରି ସାହାଯ୍ୟ କରିପାରିବି?',
  as: 'নমস্কাৰ, মই দিয়া। আজি মই আপোনাক কেনেকৈ সহায় কৰিব পাৰো?',
  ur: 'سلام، میں دیا ہوں۔ آج میں آپ کی کیسے مدد کر سکتی ہوں؟',
  sa: 'नमस्ते, अहं दिया अस्मि। अद्य अहं भवतः कथं साहाय्यं कर्तुं शक्नोमि?',
  ne: 'नमस्ते, म दिया हुँ। आज म तपाईंलाई कसरी मद्दत गर्न सक्छु?',
  kok: 'नमस्कार, हांव दिया. आयज हांव तुमकां कशी मदत करूं?',
  doi: 'नमस्ते, मैं दिया आं। अज्ज मैं तुंदी किवें मदद करी सकदी आं?',
  brx: 'नमस्कार, आं दिया। नैथिं आं नोंनि मदद खालामनो हागौ?',
  mai: 'नमस्कार, हम दिया छी। आइ हम अहाँक कोना मदद कऽ सकैत छी?',
  sat: 'ᱡᱚᱦᱟᱨ, ᱤᱧ ᱫᱤᱭᱟ᱾ ᱛᱮᱦᱮᱧ ᱤᱧ ᱟᱢᱟᱜ ᱪᱮᱫ ᱜᱚᱲᱚ ᱫᱟᱲᱮᱭᱟᱜᱼᱟ?',
  mni: 'ꯑꯩꯍꯥꯛ ꯗꯤꯌꯥ꯫ ꯉꯁꯤ ꯑꯩꯅ ꯅꯪꯕꯨ ꯀꯔꯝꯅ ꯃꯇꯦꯡ ꯄꯥꯛꯀꯅꯤ?',
  ks: 'سلام، بہ چھس دیا۔ از بہ تہنز کتھ پان کتھ مدد کرم؟',
  sd: 'سلام، آئون دیا آهیان۔ اڄ آئون توهان جي ڪيئن مدد ڪري سگهان؟',
};

const ORDER = Object.keys(SAMPLES);

function parseWav(buffer) {
  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= buffer.length) {
    const id = buffer.toString('ascii', pos, pos + 4);
    const size = buffer.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      fmt = {
        channels: buffer.readUInt16LE(body + 2),
        rate: buffer.readUInt32LE(body + 4),
        bits: buffer.readUInt16LE(body + 14),
      };
    }
    if (id === 'data') {
      data = buffer.subarray(body, Math.min(body + size, buffer.length));
      break;
    }
    pos = body + size + (size % 2);
  }
  return { fmt, data };
}

/** WAV -> mono float samples -> 16 kHz PCM16 (what Nova-3 wants). */
function toPcm16k(wav) {
  const { fmt, data } = parseWav(wav);
  if (!fmt || !data) return null;
  const bytes = fmt.bits / 8;
  const frame = bytes * fmt.channels;
  const samples = [];
  for (let i = 0; i + frame <= data.length; i += frame) {
    if (fmt.bits === 16) samples.push(data.readInt16LE(i) / 32768);
    else if (fmt.bits === 32) samples.push(data.readFloatLE(i));
    else samples.push((data.readUInt8(i) - 128) / 128);
  }
  const ratio = fmt.rate / 16000;
  const out = Buffer.alloc(Math.floor(samples.length / ratio) * 2);
  for (let i = 0; i < out.length / 2; i += 1) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const frac = src - i0;
    const value = samples[i0] * (1 - frac) + samples[i1] * frac;
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value * 32767))), i * 2);
  }
  return out;
}

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Character error rate: robust for languages without word spacing. */
function cer(expected, actual) {
  const a = normalize(expected);
  const b = normalize(actual);
  if (!a.length) return b.length ? 1 : 0;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = temp;
    }
  }
  return prev[b.length] / a.length;
}

async function synthesize(lang, text) {
  try {
    const response = await fetch(`${SIDECAR}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, lang }),
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) return { ok: false, status: response.status };
    const wav = Buffer.from(await response.arrayBuffer());
    return {
      ok: wav.length > 44,
      status: response.status,
      wav,
      engine: response.headers.get('x-engine'),
    };
  } catch (error) {
    return { ok: false, status: 0, error: error.message };
  }
}

async function whisper(wav, language) {
  const body = { audio: wav.toString('base64'), ...(language ? { language } : {}) };
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/openai/whisper-large-v3-turbo`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      },
    );
    const json = await response.json().catch(() => ({}));
    return {
      status: response.status,
      language: json?.result?.transcription_info?.language || json?.result?.language || '',
      text: json?.result?.text || '',
    };
  } catch (error) {
    return { status: 0, language: '', text: '', error: error.message };
  }
}

function nova3(pcm) {
  return new Promise((resolve) => {
    const url =
      `wss://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/deepgram/nova-3` +
      '?encoding=linear16&sample_rate=16000&language=multi';
    const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    let text = '';
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      resolve({ status: 'timeout', text });
    }, 30000);
    socket.on('open', () => {
      socket.send(pcm);
      socket.send(JSON.stringify({ type: 'CloseStream' }));
    });
    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        const alt = message?.channel?.alternatives?.[0]?.transcript;
        if (typeof alt === 'string' && alt.trim()) text = alt.trim();
      } catch {
        /* keepalive */
      }
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      resolve({ status: `error: ${error.message}`, text });
    });
    socket.on('close', () => {
      clearTimeout(timer);
      resolve({ status: 'ok', text });
    });
  });
}

function pct(value) {
  return `${(value * 100).toFixed(0)}%`;
}

async function main() {
  if (!ACCOUNT || !TOKEN) {
    console.error('CF_ACCOUNT_ID / CF_API_TOKEN missing');
    process.exit(1);
  }
  const rows = [];
  for (const lang of ORDER) {
    const text = SAMPLES[lang];
    const tts = await synthesize(lang, text);
    if (!tts.ok) {
      rows.push({ lang, tts: `missing (${tts.status})` });
      continue;
    }
    const auto = await whisper(tts.wav);
    const hinted = await whisper(tts.wav, lang);
    const nova = skipNova ? { status: 'skipped', text: '' } : await nova3(toPcm16k(tts.wav));
    rows.push({
      lang,
      tts: `${tts.engine || 'wav'} ${Math.round(tts.wav.length / 1024)}k`,
      auto: `${auto.language || '?'} ${pct(cer(text, auto.text))}`,
      hinted: `${hinted.language || '?'} ${pct(cer(text, hinted.text))}`,
      nova: nova.status === 'ok' ? `${pct(cer(text, nova.text))}` : nova.status,
    });
    console.log(
      [
        lang.padEnd(4),
        String(rows.at(-1).tts).padEnd(16),
        `auto ${String(rows.at(-1).auto).padEnd(12)}`,
        `hint ${String(rows.at(-1).hinted).padEnd(12)}`,
        `nova ${rows.at(-1).nova}`,
      ].join(' | '),
    );
  }
  const missing = rows
    .filter((row) => String(row.tts).startsWith('missing'))
    .map((row) => row.lang);
  console.log('\n--- summary');
  console.log('languages tested:', rows.length);
  console.log('tts missing:', missing.length ? missing.join(', ') : 'none');
  const avg = (key) => {
    const values = rows
      .filter((row) => row[key] && !String(row[key]).includes('missing'))
      .map((row) => Number.parseFloat(String(row[key]).split(' ').at(-1)))
      .filter((value) => Number.isFinite(value));
    return values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : 'n/a';
  };
  console.log('mean CER auto:', avg('auto'), '% | hinted:', avg('hinted'), '%');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
