import {
  RECALL_MAX_QUERY_LENGTH,
  RECALL_SNIPPET_MAX_LENGTH,
  buildRecallUserFilter,
  mergeRecallHits,
  pickRecallSnippet,
  runRecall,
  validateRecallQuery,
} from './index';

describe('validateRecallQuery', () => {
  it('trims and accepts a normal query', () => {
    expect(validateRecallQuery('  kubernetes ingress  ')).toEqual({
      ok: true,
      value: 'kubernetes ingress',
    });
  });

  it('rejects missing, blank, and non-string queries', () => {
    expect(validateRecallQuery(undefined).ok).toBe(false);
    expect(validateRecallQuery('').ok).toBe(false);
    expect(validateRecallQuery('   ').ok).toBe(false);
    expect(validateRecallQuery(42).ok).toBe(false);
  });

  it('rejects oversized queries', () => {
    expect(validateRecallQuery('a'.repeat(RECALL_MAX_QUERY_LENGTH + 1)).ok).toBe(false);
    expect(validateRecallQuery('a'.repeat(RECALL_MAX_QUERY_LENGTH)).ok).toBe(true);
  });
});

describe('buildRecallUserFilter', () => {
  it('scopes the filter to the exact user id', () => {
    expect(buildRecallUserFilter('user-123')).toBe('user = "user-123"');
  });

  it('escapes backslashes and double quotes', () => {
    expect(buildRecallUserFilter('we"ird\\id')).toBe('user = "we\\"ird\\\\id"');
  });
});

describe('pickRecallSnippet', () => {
  it('prefers the cropped formatted text over everything else', () => {
    const hit = {
      title: 'T',
      text: 'long body '.repeat(50),
      _formatted: { text: '…around the match…', title: 'T' },
    };
    expect(pickRecallSnippet(hit)).toBe('…around the match…');
  });

  it('falls back to formatted title, then raw title, then raw text', () => {
    expect(pickRecallSnippet({ title: 'T', text: 'body', _formatted: { title: 'T…' } })).toBe('T…');
    expect(pickRecallSnippet({ title: 'T', text: 'body' })).toBe('T');
    expect(pickRecallSnippet({ text: 'body' })).toBe('body');
  });

  it('returns empty for a hit with no string candidates', () => {
    expect(pickRecallSnippet({})).toBe('');
    expect(pickRecallSnippet({ title: 42, text: null })).toBe('');
  });

  it('caps uncropped snippets at the max length with an ellipsis', () => {
    const snippet = pickRecallSnippet({ text: 'x'.repeat(RECALL_SNIPPET_MAX_LENGTH + 100) });
    expect(snippet.length).toBe(RECALL_SNIPPET_MAX_LENGTH + 1);
    expect(snippet.endsWith('…')).toBe(true);
  });
});

describe('mergeRecallHits', () => {
  it('puts title hits first, dedupes by conversationId, and caps at the limit', () => {
    const merged = mergeRecallHits(
      [{ conversationId: 'a', title: 'A', _formatted: { title: 'A…' } }],
      [
        { conversationId: 'b', text: 'b body', _formatted: { text: 'b…' } },
        { conversationId: 'a', text: 'a body' },
        { conversationId: 'c', text: 'c body' },
      ],
      2,
    );
    expect(merged.map((h) => h.conversationId)).toEqual(['a', 'b']);
    expect(merged[0].title).toBe('A');
    expect(merged[0].snippet).toBe('A…');
    expect(merged[1].snippet).toBe('b…');
  });

  it('drops hits without a string conversationId', () => {
    const merged = mergeRecallHits([{ title: 'no id' }], [{ conversationId: 'b' }], 5);
    expect(merged.map((h) => h.conversationId)).toEqual(['b']);
  });

  it('titles message-only conversations Untitled before hydration', () => {
    const merged = mergeRecallHits([], [{ conversationId: 'b', text: 'x' }], 5);
    expect(merged[0].title).toBe('Untitled');
  });
});

describe('runRecall', () => {
  const search = jest.fn(async (index: string, _q: string, params: { filter?: string }) => {
    expect(params.filter).toBe('user = "u1"');
    if (index === 'convos') {
      return { hits: [{ conversationId: 'a', title: 'A', _formatted: { title: 'A…' } }] };
    }
    return { hits: [{ conversationId: 'a', text: 'a body' }, { conversationId: 'b', text: 'b body', _formatted: { text: 'b…' } }] };
  });
  const getConvoMap = jest.fn(async (_userId: string, ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, { title: `${id} title`, updatedAt: new Date('2026-01-02T03:04:05Z') }])),
  );

  it('scopes searches to the user and hydrates metadata', async () => {
    const { status, body } = await runRecall({
      query: 'ingress',
      userId: 'u1',
      search,
      getConvoMap,
      limit: 5,
    });
    expect(status).toBe(200);
    expect(search).toHaveBeenCalledTimes(2);
    const hits = (body as { hits: Array<{ conversationId: string; title: string; updatedAt: string | null }> }).hits;
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({
      conversationId: 'a',
      title: 'a title',
      snippet: 'A…',
      updatedAt: '2026-01-02T03:04:05.000Z',
    });
    expect(hits[1].title).toBe('b title');
  });

  it('returns 401 without a user, 400 for a bad query, 503 without a client', async () => {
    const base = { search, getConvoMap };
    expect((await runRecall({ ...base, query: 'x', userId: undefined })).status).toBe(401);
    expect((await runRecall({ ...base, query: ' ', userId: 'u1' })).status).toBe(400);
    expect((await runRecall({ ...base, query: 'x', userId: 'u1', search: null })).status).toBe(503);
  });

  it('returns 502 when both indexes fail and still serves title hits when only messages fail', async () => {
    const failing = jest.fn(async () => {
      throw new Error('down');
    });
    const both = await runRecall({ query: 'x', userId: 'u1', search: failing, getConvoMap });
    expect(both.status).toBe(502);

    const convoOnly = jest.fn(async (index: string) => {
      if (index === 'messages') {
        throw new Error('down');
      }
      return { hits: [{ conversationId: 'a', title: 'A' }] };
    });
    const partial = await runRecall({ query: 'x', userId: 'u1', search: convoOnly, getConvoMap });
    expect(partial.status).toBe(200);
    expect((partial.body as { hits: unknown[] }).hits).toHaveLength(1);
  });

  it('tolerates a metadata lookup failure', async () => {
    const { status, body } = await runRecall({
      query: 'x',
      userId: 'u1',
      search: jest.fn(async () => ({ hits: [{ conversationId: 'a', title: 'A' }] })),
      getConvoMap: jest.fn(async () => {
        throw new Error('mongo down');
      }),
    });
    expect(status).toBe(200);
    expect((body as { hits: Array<{ title: string; updatedAt: string | null }> }).hits[0]).toEqual({
      conversationId: 'a',
      title: 'A',
      snippet: 'A',
      updatedAt: null,
    });
  });
});
