/**
 * E2E probe for the Diya voice endpoints on the pod.
 * Mints a real user JWT, speaks text via /api/voice/tts, then feeds that audio
 * back into /api/voice/stt and prints the transcript. Verifies the whole
 * speak -> hear loop for each language without a browser.
 *
 * Run on the pod:  node /tmp/voice-e2e.js
 */
const fs = require('fs');
const path = require('path');

const RELEASE = '/workspace/baanzon-next';
const PORT = fs.readFileSync('/workspace/data/active-port', 'utf8').trim();

function envValue(key) {
  const line = fs
    .readFileSync(path.join(RELEASE, '.env'), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${key}=`));
  return line
    ? line
        .slice(key.length + 1)
        .replace(/^"|"$/g, '')
        .trim()
    : '';
}

async function main() {
  const jwt = require(path.join(RELEASE, 'node_modules/jsonwebtoken'));
  const { MongoClient } = require(path.join(RELEASE, 'node_modules/mongodb'));

  const client = new MongoClient('mongodb://127.0.0.1:27017/LibreChat');
  await client.connect();
  const user = await client
    .db()
    .collection('users')
    .findOne({}, { projection: { _id: 1 } });
  await client.close();
  if (!user) {
    throw new Error('no user in the database to mint a token for');
  }

  const token = jwt.sign({ id: String(user._id) }, envValue('JWT_SECRET'), { expiresIn: '10m' });
  const base = `http://127.0.0.1:${PORT}`;

  const cases = [
    ['en', 'Hello, I am Diya. It is good to hear you.'],
    ['hi', 'नमस्ते, मैं दिया हूँ। आपसे मिलकर अच्छा लगा।'],
    ['ta', 'வணக்கம், நான் தியா. உங்களை சந்திப்பதில் மகிழ்ச்சி.'],
  ];

  for (const [lang, text] of cases) {
    const tts = await fetch(`${base}/api/voice/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text, lang }),
    });
    const audio = Buffer.from(await tts.arrayBuffer());
    const engine = tts.headers.get('x-voice-engine');
    console.log(`tts ${lang}: ${tts.status} ${audio.length}B engine=${engine}`);
    if (!tts.ok || audio.length === 0) {
      continue;
    }

    const stt = await fetch(`${base}/api/voice/stt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ audio: audio.toString('base64') }),
    });
    const heard = await stt.json();
    console.log(
      `stt ${lang}: ${stt.status} lang=${heard.language} text=${JSON.stringify(heard.text || heard.error)}`,
    );
  }

  // The brain: greeting fast-path plus a real turn in a non-Latin script.
  for (const [label, text] of [
    ['en-greet', 'hey diya'],
    ['hi-greet', 'नमस्ते दिया'],
    ['ta-turn', 'உங்கள் பெயர் என்ன?'],
  ]) {
    const turn = await fetch(`${base}/api/diya/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text, history: [] }),
    });
    const data = await turn.json();
    console.log(
      `turn ${label}: ${turn.status} ${JSON.stringify((data.reply || data.error || '').slice(0, 90))}`,
    );
  }
}

main().catch((error) => {
  console.error('probe failed:', error.message);
  process.exit(1);
});
