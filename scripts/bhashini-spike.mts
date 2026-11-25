/**
 * Bhashini spike: does ULCA ASR/TTS cover the languages MMS cannot?
 *
 * Round-trips text -> Bhashini TTS -> Bhashini ASR for every scheduled language
 * that has no MMS voice, plus Telugu/Marathi (Whisper mis-detects both) and
 * Tamil/Hindi controls. Prints latency and character error per language.
 *
 *   BHASHINI_USER_ID=... BHASHINI_ULCA_API_KEY=... BHASHINI_PIPELINE_ID=... \
 *     npx tsx scripts/bhashini-spike.mts
 *
 * Optional: --whisper also scores the same audio through Whisper for a
 * side-by-side comparison.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  bhashiniAsr,
  bhashiniTts,
  resolveBhashiniPipeline,
} from '../packages/api/src/voice/providers/bhashini';

const SAMPLES: Record<string, string> = {
  hi: 'नमस्ते, मैं दिया हूँ। आज मैं आपकी कैसे मदद कर सकती हूँ?',
  ta: 'வணக்கம், நான் தியா. இன்று நான் உங்களுக்கு எப்படி உதவலாம்?',
  te: 'నమస్తే, నేను దియా. ఈరోజు మీకు ఎలా సహాయపడతాను?',
  mr: 'नमस्कार, मी दिया आहे. आज मी तुम्हाला कशी मदत करू शकते?',
  ur: 'سلام، میں دیا ہوں۔ آج میں آپ کی کیسے مدد کر سکتی ہوں؟',
  mai: 'नमस्कार, हम दिया छी। आइ हम अहाँक कोना मदद कऽ सकैत छी?',
  ne: 'नमस्ते, म दिया हुँ। आज म तपाईंलाई कसरी मद्दत गर्न सक्छु?',
  sa: 'नमस्ते, अहं दिया अस्मि। अद्य अहं भवतः कथं साहाय्यं कर्तुं शक्नोमि?',
  kok: 'नमस्कार, हांव दिया. आयज हांव तुमकां कशी मदत करूं?',
  doi: 'नमस्ते, मैं दिया आं। अज्ज मैं तुंदी किवें मदद करी सकदी आं?',
  brx: 'नमस्कार, आं दिया। नैथिं आं नोंनि मदद खालामनो हागौ?',
  sat: 'ᱡᱚᱦᱟᱨ, ᱤᱧ ᱫᱤᱭᱟ᱾ ᱛᱮᱦᱮᱧ ᱤᱧ ᱟᱢᱟᱜ ᱪᱮᱫ ᱜᱚᱲᱚ ᱫᱟᱲᱮᱭᱟᱜᱼᱟ?',
  mni: 'ꯑꯩꯍꯥꯛ ꯗꯤꯌꯥ꯫ ꩻꯁꯤ ꯑꯩꯅ ꯅꯪꯕꯨ ꯀꯔꯝꯅ ꯃꯇꯦꯡ ꯄꯥꯛꯀꯅꯤ?',
  ks: 'سلام، بہ چھس دیا۔ از بہ تہنز کتھ پان کتھ مدد کرم؟',
  sd: 'سلام، آئون دیا آهيان۔ اڄ آئون توهان جي ڪيئن مدد ڪري سگهان؟',
};

const ORDER = Object.keys(SAMPLES);
const wantWhisper = process.argv.includes('--whisper');

function env(name: string): string {
  if (process.env[name]) return process.env[name] as string;
  try {
    const text = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
    const match = text.match(new RegExp(`^${name}=(.*)$`, 'm'));
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

function normalize(text: string): string {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function cer(expected: string, actual: string): number {
  const a = normalize(expected);
  const b = normalize(actual);
  if (!a.length) return b.length ? 1 : 0;
  const prev = new Array<number>(b.length + 1);
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

async function whisper(wav: Buffer): Promise<string> {
  const account = env('CF_ACCOUNT_ID');
  const token = env('CF_API_TOKEN');
  if (!account || !token) return '';
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/openai/whisper-large-v3-turbo`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: wav.toString('base64') }),
        signal: AbortSignal.timeout(60000),
      },
    );
    const json = (await response.json()) as { result?: { text?: string } };
    return json?.result?.text ?? '';
  } catch {
    return '';
  }
}

async function main() {
  const credentials = {
    userId: env('BHASHINI_USER_ID'),
    ulcaApiKey: env('BHASHINI_ULCA_API_KEY'),
    pipelineId: env('BHASHINI_PIPELINE_ID'),
  };
  if (!credentials.userId || !credentials.ulcaApiKey || !credentials.pipelineId) {
    console.error(
      [
        'Bhashini credentials missing.',
        'Register at https://bhashini.gov.in/ulca, verify the email, then copy from My Profile:',
        '  userID            -> BHASHINI_USER_ID',
        '  ulcaApiKey        -> BHASHINI_ULCA_API_KEY',
        '  pipeline ID (from the pipeline page) -> BHASHINI_PIPELINE_ID',
        '',
        'The ULCA endpoint is reachable from this pod (verified: it answers 400 for a bad key).',
      ].join('\n'),
    );
    process.exit(1);
  }

  console.log('lang | tts | asr | CER | whisper CER | ms');
  for (const lang of ORDER) {
    const startedAt = Date.now();
    const pipeline = await resolveBhashiniPipeline({
      credentials,
      tasks: ['asr', 'tts'],
      language: lang,
    });
    if (!pipeline) {
      console.log(`${lang.padEnd(4)} | pipeline unavailable`);
      continue;
    }
    const wav = await bhashiniTts({ pipeline, text: SAMPLES[lang], language: lang });
    if (!wav) {
      console.log(`${lang.padEnd(4)} | tts failed`);
      continue;
    }
    const transcript = await bhashiniAsr({ pipeline, audio: wav, language: lang });
    if (transcript == null) {
      console.log(`${lang.padEnd(4)} | tts ok | asr failed`);
      continue;
    }
    const ms = Date.now() - startedAt;
    const whisperText = wantWhisper ? await whisper(wav) : '';
    console.log(
      [
        lang.padEnd(4),
        'tts ok',
        'asr ok',
        `${(cer(SAMPLES[lang], transcript) * 100).toFixed(0)}%`,
        wantWhisper ? `${(cer(SAMPLES[lang], whisperText) * 100).toFixed(0)}%` : '-',
        `${ms}ms`,
      ].join(' | '),
    );
  }
}

void main();
