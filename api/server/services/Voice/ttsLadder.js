/**
 * Speech-out provider ladder shared by the read-aloud route and the realtime
 * voice gateway: en -> aura-1, es -> aura-2-es, everything else -> the local
 * Kokoro/MMS sidecar. One ladder means a language sounds the same whether it
 * is read aloud or spoken in a live voice turn, and no device voice is used.
 */
const { logger } = require('@librechat/data-schemas');

const SIDECAR_URL = process.env.VOICE_TTS_URL || 'http://127.0.0.1:8471';

async function cfRun(model, body) {
  const account = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN;
  if (!account || !token) {
    throw new Error('Cloudflare is not configured');
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw new Error(`CF ${model} ${response.status}`);
  }
  return response;
}

async function sidecarTts(text, lang) {
  const response = await fetch(`${SIDECAR_URL}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, lang }),
    // Cold MMS loads pull weights from the HF cache; give the first call room.
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    throw new Error(`sidecar ${response.status}`);
  }
  return { buffer: Buffer.from(await response.arrayBuffer()), mime: 'audio/wav' };
}

/** Ordered providers per language: best human voice first, sidecar as the
 *  always-available fallback (and primary for Indic). */
async function synthesize(text, lang) {
  const errors = [];
  const attempts = [];
  if (lang === 'en') {
    attempts.push([
      'aura-1',
      async () => {
        const response = await cfRun('@cf/deepgram/aura-1', { text });
        return { buffer: Buffer.from(await response.arrayBuffer()), mime: 'audio/mpeg' };
      },
    ]);
  }
  if (lang === 'es') {
    attempts.push([
      'aura-2-es',
      async () => {
        const response = await cfRun('@cf/deepgram/aura-2-es', { text });
        return { buffer: Buffer.from(await response.arrayBuffer()), mime: 'audio/mpeg' };
      },
    ]);
  }
  attempts.push([`sidecar:${lang}`, () => sidecarTts(text, lang)]);

  for (const [name, attempt] of attempts) {
    try {
      const audio = await attempt();
      if (audio.buffer.length > 0) {
        logger.debug(`[voice] tts ok lang=${lang} engine=${name} bytes=${audio.buffer.length}`);
        return { ...audio, engine: name };
      }
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
      logger.warn(`[voice] tts ${name} failed: ${error.message}`);
    }
  }

  // Last resort is gone on purpose: an English voice reading Tamil, Marathi or
  // Cyrillic text is not "something rather than silence", it is the wrong
  // language, which is exactly what users reported. A failure is surfaced.
  const error = new Error('no TTS provider could synthesize this language');
  error.details = errors.join('; ');
  throw error;
}

module.exports = { cfRun, sidecarTts, synthesize };
