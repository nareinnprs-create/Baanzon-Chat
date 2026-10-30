/**
 * Pure text logic for the Voice controls, kept free of DOM and React so the
 * dictation slot arithmetic and the TTS chunker can be tested in isolation.
 */

/**
 * The composer range the current dictation owns. While listening, every
 * recognition event rewrites exactly this range, so interim updates never
 * duplicate and whatever the user typed around the caret is preserved.
 */
export type InsertionSlot = { start: number; length: number };

/**
 * Insert (first call, at the caret) or rewrite (later calls, over `slot`)
 * a dictation snippet inside `current`, and report where the caret belongs.
 */
export function applyTranscript(
  current: string,
  snippet: string,
  slot: InsertionSlot | null,
  caret = current.length,
): { text: string; cursor: number; slot: InsertionSlot } {
  if (slot == null) {
    const start = Math.max(0, Math.min(caret, current.length));
    const before = current.slice(0, start);
    const after = current.slice(start);
    const lead = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
    const trail = after.length > 0 && !/^\s/.test(after) ? ' ' : '';
    const piece = lead + snippet + trail;
    return {
      text: before + piece + after,
      cursor: start + piece.length,
      slot: { start, length: piece.length },
    };
  }
  const before = current.slice(0, slot.start);
  const after = current.slice(slot.start + slot.length);
  const lead = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
  const trail = after.length > 0 && !/^\s/.test(after) ? ' ' : '';
  const piece = lead + snippet + trail;
  return {
    text: before + piece + after,
    cursor: slot.start + piece.length,
    slot: { start: slot.start, length: piece.length },
  };
}

/**
 * Split text into sentence-sized pieces of at most `maxLen` characters for
 * sequential speechSynthesis queueing — utterances beyond a few hundred
 * characters are silently dropped on some engines.
 */
export function chunkForSpeech(text: string, maxLen = 200): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) {
    return [];
  }
  const sentences = normalized.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) ?? [];
  const chunks: string[] = [];
  let buffer = '';
  for (const sentence of sentences) {
    if (sentence.length > maxLen) {
      if (buffer.trim()) {
        chunks.push(buffer.trim());
      }
      buffer = '';
      for (let i = 0; i < sentence.length; i += maxLen) {
        chunks.push(sentence.slice(i, i + maxLen).trim());
      }
      continue;
    }
    if (buffer.length + sentence.length > maxLen) {
      chunks.push(buffer.trim());
      buffer = '';
    }
    buffer += sentence;
  }
  if (buffer.trim()) {
    chunks.push(buffer.trim());
  }
  return chunks.filter((chunk) => chunk.length > 0);
}

/** First voice whose locale matches the document language, else undefined. */
export function pickVoiceForLanguage(
  voices: SpeechSynthesisVoice[],
  language: string,
): SpeechSynthesisVoice | undefined {
  if (!language) {
    return undefined;
  }
  const lang = language.toLowerCase();
  return (
    voices.find((voice) => voice.lang.toLowerCase() === lang) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(lang.split('-')[0]))
  );
}
