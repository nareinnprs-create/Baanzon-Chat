const express = require('express');
const { logger } = require('@librechat/data-schemas');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { projectsLimiter } = require('~/server/middleware/limiters');
const { resolveModelChain } = require('~/server/services/billing/modelRouter');

const router = express.Router();

const UNAVAILABLE = 'diya_unavailable';
const UPSTREAM = 'diya_upstream';

/** Diya's persona: female voice assistant with a natural human cadence.
 *  Greetings get an explicit identity acknowledgment; spoken style rules
 *  keep replies sounding like a person, not a document. */
const SYSTEM_PROMPT = [
  'You are Diya, a warm, upbeat female voice assistant in the Diya Orb app.',
  'If the user greets you (hey, hi, hello, namaste, good morning and the like),',
  'greet them back warmly and mention your name - "Hi! I am Diya, great to hear you."',
  'If asked who you are, say you are Diya, a voice assistant. Never claim another name.',
  'Reply in natural spoken language: short sentences, plain words, contractions,',
  'occasional natural fillers ("hmm", "okay so"). One to three sentences by default.',
  'No markdown, no lists, no code, no emoji, no stage directions - the reply is read aloud.',
  'Keep replies under 120 words unless the user asks for more. Do not mention model names.',
  'Always reply in the language the user wrote or spoke in.',
].join(' ');

/** Greeting fast-path: greetings answer instantly without the model round
 *  trip, so "hey Diya" acks in well under a second. Localized for the most
 *  common languages; the model handles everything else. */
const GREETING_RE =
  /^(hey|hi|hello|yo|namaste|namaskar|vanakkam|namaskaram|hola|salut|bonjour|ciao|good\s+(morning|afternoon|evening)|olá|नमस्ते|नमस्कार|वणक्कम|నమస్కారం|নমস্কার|ਸਤ ਸ੍ਰੀ ਅਕਾਲ|નમસ્તે|ನಮಸ್ಕಾರ)[\s,.!]*(diya|ਦਿਆ|દિયા)?[\s!.]*$/i;

const GREETING_ACKS = {
  en: "Hey! I'm Diya - good to hear you. What's on your mind?",
  hi: 'नमस्ते! मैं दिया हूँ - आपको सुनकर अच्छा लगा। बताइए, क्या मदद करूँ?',
  ta: 'வணக்கம்! நான் தியா - உங்களைக் கேட்டது மகிழ்ச்சி. என்ன உதவி வேண்டும்?',
  te: 'నమస్కారం! నేను దియా - మిమ్మల్ని విన్నందుకు సంతోషం. ఏమి సహాయం చేయాలి?',
  bn: 'নমস্কার! আমি দিয়া - আপনাকে শুনে ভালো লাগল। কী সাহায্য করব?',
  mr: 'नमस्कार! मी दिया - तुम्हाला ऐकून आनंद झाला. काय मदत करू?',
  gu: 'નમસ્તે! હું દિયા છુઁ - તમને સાંભળીને આનંદ થયો. શું મદદ કરું?',
  kn: 'ನಮಸ್ಕಾರ! ನಾನು ದಿಯಾ - ನಿಮ್ಮನ್ನು ಕೇಳಿ ಸಂತೋಷ. ಏನು ಸಹಾಯ ಮಾಡಬೇಕು?',
  ml: 'നമസ്കാരം! ഞാൻ ദിയയാണ് - നിങ്ങളെ കേട്ടതിൽ സന്തോഷം. എന്ത് സഹായം വേണം?',
  pa: 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਮੈਂ ਦਿਆ ਹਾਂ - ਤੁਹਾਨੂੰ ਸੁਣ ਕੇ ਖੁਸ਼ੀ ਹੋਈ। ਕੀ ਮਦਦ ਕਰਾਂ?',
  es: '¡Hola! Soy Diya, encantada de oírte. ¿En qué te ayudo?',
  fr: "Salut ! Je suis Diya, ravi de t'entendre. Comment puis-je aider ?",
};

/** Picks the ack language by the script in the greeting (Indic scripts are
 *  unambiguous); everything else defaults to English, which the TTS ladder
 *  speaks with the server voice. */
function ackLanguage(greeting) {
  const ranges = [
    [/[\u0900-\u097F]/, 'hi'],
    [/[\u0B80-\u0BFF]/, 'ta'],
    [/[\u0C00-\u0C7F]/, 'te'],
    [/[\u0980-\u09FF]/, 'bn'],
    [/[\u0A00-\u0A7F]/, 'pa'],
    [/[\u0A80-\u0AFF]/, 'gu'],
    [/[\u0C80-\u0CFF]/, 'kn'],
    [/[\u0D00-\u0D7F]/, 'ml'],
  ];
  for (const [re, code] of ranges) {
    if (re.test(greeting)) {
      return code;
    }
  }
  if (/^(hola|olá)/i.test(greeting)) {
    return 'es';
  }
  if (/^(salut|bonjour)/i.test(greeting)) {
    return 'fr';
  }
  return 'en';
}

/**
 * One voice turn for Diya Orb: speech-to-text arrives as `text`, the reply
 * text goes back to be spoken in the browser. Stateless on purpose - the
 * client echoes the recent turns back in `history`, so there is no session
 * store and horizontal scaling needs nothing. The model rides the user's
 * tier-resolved Swift chain (multilingual voice defaults), so a deprecated
 * backing fails over automatically; the model identity never reaches the
 * response.
 */
router.post('/turn', requireJwtAuth, projectsLimiter, async (req, res) => {
  const settings = req.config?.config?.diya;
  if (settings && settings.enabled === false) {
    return res.status(503).json({ error: UNAVAILABLE });
  }
  const { text, history } = req.body ?? {};
  if (typeof text !== 'string' || text.trim() === '' || text.length > 4000) {
    return res.status(400).json({ error: 'text is required (1..4000 chars)' });
  }
  if (history != null && (!Array.isArray(history) || history.length > 16)) {
    return res.status(400).json({ error: 'history must be an array of at most 16 turns' });
  }
  for (const turn of history ?? []) {
    if (
      !turn ||
      (turn.role !== 'user' && turn.role !== 'assistant') ||
      typeof turn.content !== 'string' ||
      turn.content.length > 4000
    ) {
      return res.status(400).json({ error: 'invalid history turn' });
    }
  }

  const trimmed = text.trim();

  // Greeting fast-path: acknowledge identity instantly, no model round trip.
  if (GREETING_RE.test(trimmed)) {
    return res.json({ reply: GREETING_ACKS[ackLanguage(trimmed)] ?? GREETING_ACKS.en });
  }

  const base = process.env.OPRAIZ_BASEURL;
  const key = process.env.OPRAIZ_API_KEY;
  if (!base || !key) {
    return res.status(503).json({ error: UNAVAILABLE });
  }
  const tier = String(req.user?.subscriptionTier || 'free').toLowerCase();
  const chain = resolveModelChain(tier, 'baanzon-swift', trimmed);
  const model = chain[0] || process.env.VOICE_MODEL || '@cf/zai-org/glm-4.7-flash';

  try {
    const upstream = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...(history ?? []).slice(-12).map((turn) => ({ role: turn.role, content: turn.content })),
          { role: 'user', content: trimmed },
        ],
      }),
    });
    if (!upstream.ok) {
      logger.warn('[diya] upstream rejected the turn', { status: upstream.status });
      return res.status(502).json({ error: UPSTREAM });
    }
    const data = await upstream.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      return res.status(502).json({ error: UPSTREAM });
    }
    return res.json({ reply });
  } catch (err) {
    logger.error('[diya] turn failed', err);
    return res.status(502).json({ error: UPSTREAM });
  }
});

module.exports = router;
