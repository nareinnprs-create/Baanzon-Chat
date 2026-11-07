import { snippetsToEvidenceSources } from './evidence';

describe('snippetsToEvidenceSources', () => {
  it('preserves private-document provenance and clamps confidence', () => {
    expect(
      snippetsToEvidenceSources([
        {
          collectionId: 'collection-1',
          documentId: 'doc-1',
          chunkIndex: 2,
          text: 'Verified text',
          score: 1.4,
          source: 'hybrid',
          metadata: {
            source: 'handbook.pdf',
            url: 'https://example.test/handbook.pdf',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      ]),
    ).toEqual([
      {
        id: 'doc-1:2',
        type: 'private_document',
        title: 'handbook.pdf',
        uri: 'https://example.test/handbook.pdf',
        excerpt: 'Verified text',
        updatedAt: '2026-01-01T00:00:00.000Z',
        confidence: 1,
        citation: 'handbook.pdf · section 3',
        permissionScope: 'knowledge:collection-1',
      },
    ]);
  });

  it('does not invent optional metadata', () => {
    expect(
      snippetsToEvidenceSources([
        {
          collectionId: 'collection-1',
          documentId: 'doc-1',
          chunkIndex: 0,
          text: 'Text',
          score: -1,
          source: 'keyword',
        },
      ]),
    ).toEqual([
      {
        id: 'doc-1:0',
        type: 'private_document',
        excerpt: 'Text',
        confidence: 0,
        citation: 'doc-1:0',
        permissionScope: 'knowledge:collection-1',
      },
    ]);
  });
});
