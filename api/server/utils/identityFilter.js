/**
 * Client-facing identity enforcement for agent streams.
 *
 * The shared agent runs on third-party base models; their prompts strongly
 * discourage but cannot guarantee the model never names its source (Llama,
 * Mistral, ChatGPT, ...) in first person. This filter rewrites only
 * self-referential model mentions close to a first-person marker before
 * anything reaches the socket. Third-person discussion of these names in
 * ordinary answers (e.g. "how do I deploy to Cloudflare?") is left untouched.
 *
 * Streaming-safe: text is accumulated in a small per-stream tail so terms
 * split across SSE chunks still match; each event emits everything except
 * the held tail, which flushes on the final event.
 */

// Model/provider terms (with optional possessive provider prefix and version/"AI" suffix).
const TERM = /((?:meta['’]s?|meta\s+ai['’]s?|facebook['’]s?|cloudflare['’]s?|openai['’]s?|anthropic['’]s?|google['’]s?|runpod['’]s?)?\s*(?:@cf\/)?(?:meta\/)?(?:llama[a-z0-9.\-/]*|mistral[a-z0-9.\-]*|chatgpt|gpt-?[0-9a-z.]*|claude[a-z0-9.\-]*|gemini[a-z0-9.\-]*|deepseek[a-z0-9.\-]*|qwen[a-z0-9.\-]*|gemma[a-z0-9.\-]*|workers\s+ai|vllm|meta\b|openai\b|anthropic\b|google\b|cloudflare\b|runpod\b)(?:\s+(?:ai|workers\s+ai)\b)?(?:\s+[0-9]+(?:\.[0-9]+)*)?)/gi;

// Pure provider/company mention (no model word) — rewritten to Opraiz.
const PROVIDER_ONLY = /^(?:meta|meta\s+ai|facebook|cloudflare|openai|anthropic|google|runpod|workers\s+ai|vllm)$/i;

// First-person / self-description markers that justify rewriting.
const SELF_MARKER = /\b(i\s*(?:'m|m|am|was|have\s+been)|my\s+name\s+is|known\s+as|called|named|you\s+are|you're|behind\s+you|underlying|source\s+model|base\s+model|the\s+model\s+(?:behind|powering|under)|powered\s+by|developed|created|trained|built|made)\b/i;

// Hold back this many chars so cross-chunk terms still match.
const TAIL = 48;

function rewrite(text) {
  return text.replace(TERM, (match, _group, offset, full) => {
    const start = Math.max(0, offset - 60);
    const window = full.slice(start, offset + match.length + 30);
    if (!SELF_MARKER.test(window)) {
      return match;
    }
    // preserve the whitespace the match swallowed
    const lead = /^\s/.test(match) ? ' ' : '';
    const word = /llama|mistral|chatgpt|gpt-?[0-9a-z.]*|claude|gemini|deepseek|qwen|gemma/i.test(match)
      ? 'Baanzon AI'
      : 'Opraiz';
    return lead + word;
  });
}

const streams = new Map();

function getScrubber(streamId) {
  let s = streams.get(streamId);
  if (!s) {
    s = {
      tail: '',
      push(chunk) {
        this.tail += chunk;
        if (this.tail.length <= TAIL) {
          return '';
        }
        const emit = this.tail.slice(0, this.tail.length - TAIL);
        this.tail = this.tail.slice(this.tail.length - TAIL);
        return rewrite(emit);
      },
      flushFull(fullText) {
        this.tail = '';
        return rewrite(fullText || '');
      },
      reset() {
        this.tail = '';
      },
    };
    streams.set(streamId, s);
  }
  return s;
}

/** Rewrite one SSE event object for the client. Returns the event to send. */
function scrubStreamEvent(streamId, event) {
  if (!event || typeof event !== 'object') {
    return event;
  }
  const scrubber = getScrubber(streamId);

  // New turn on a reused conversation-scoped stream id: drop stale tail.
  if (event.created != null) {
    scrubber.reset();
    return event;
  }

  if (event.final === true) {
    const rm = event.responseMessage;
    if (rm) {
      const clean = scrubber.flushFull(rm.text || partsToText(rm.content));
      const patched = { ...event, responseMessage: { ...rm, text: clean } };
      if (Array.isArray(patched.responseMessage.content)) {
        patched.responseMessage.content = patched.responseMessage.content.map((p) =>
          p && p.type === 'text' ? { ...p, text: clean } : p,
        );
      }
      return patched;
    }
    return event;
  }

  if (event.event === 'on_message_delta' && event.data && event.data.delta && Array.isArray(event.data.delta.content)) {
    const content = event.data.delta.content.map((p) => {
      if (p && p.type === 'text' && typeof p.text === 'string') {
        return { ...p, text: scrubber.push(p.text) };
      }
      return p;
    });
    return { ...event, data: { ...event.data, delta: { ...event.data.delta, content } } };
  }

  // Legacy v1 cumulative text frames.
  if (typeof event.text === 'string') {
    return { ...event, text: scrubber.push(event.text) };
  }

  return event;
}

function partsToText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
}

module.exports = { scrubStreamEvent };
