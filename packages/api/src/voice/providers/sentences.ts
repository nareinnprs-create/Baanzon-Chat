/**
 * Streaming sentence splitter: feeds LLM deltas in, emits complete sentences
 * for TTS. Runaway text (no ender in sight) is force-split at a soft boundary
 * so first audio is never waiting on a paragraph.
 */
export interface SentenceSplitter {
  push(delta: string): string[];
  tail(): string;
}

export function createSentenceSplitter(maxLen = 400): SentenceSplitter {
  let buf = '';
  return {
    push(delta: string): string[] {
      buf += delta;
      const out: string[] = [];
      // Sentence enders followed by whitespace; "3.14" survives (no space
      // after the dot), "Hello. World" splits.
      const ender = /[.!?…]+["'”’)\]]*\s+/g;
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = ender.exec(buf)) !== null) {
        const end = m.index + m[0].length;
        const sentence = buf.slice(last, end).trim();
        if (sentence) {
          out.push(sentence);
        }
        last = end;
      }
      buf = buf.slice(last);
      if (buf.length >= maxLen) {
        const soft = Math.max(buf.lastIndexOf(', ', maxLen), buf.lastIndexOf(' ', maxLen));
        const at = soft > 40 ? soft + 1 : maxLen;
        const chunk = buf.slice(0, at).trim();
        if (chunk) {
          out.push(chunk);
        }
        buf = buf.slice(at).trimStart();
      }
      return out;
    },
    tail(): string {
      const t = buf.trim();
      buf = '';
      return t;
    },
  };
}
