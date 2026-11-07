import type { EvidenceSource } from 'librechat-data-provider';
import type { RetrievedSnippet } from './types';

const stringMetadata = (metadata: Record<string, unknown> | undefined, key: string): string | undefined => {
  const value = metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

/** Convert authorized knowledge hits into the shared provenance format. */
export function snippetsToEvidenceSources(snippets: RetrievedSnippet[]): EvidenceSource[] {
  return snippets.map((snippet) => {
    const source = stringMetadata(snippet.metadata, 'source');
    const uri = stringMetadata(snippet.metadata, 'url') ?? stringMetadata(snippet.metadata, 'uri');
    const updatedAt = stringMetadata(snippet.metadata, 'updatedAt');
    const id = `${snippet.documentId}:${snippet.chunkIndex}`;

    return {
      id,
      type: 'private_document',
      ...(source ? { title: source } : {}),
      ...(uri ? { uri } : {}),
      excerpt: snippet.text,
      ...(updatedAt ? { updatedAt } : {}),
      confidence: Math.max(0, Math.min(1, snippet.score)),
      citation: source ? `${source} · section ${snippet.chunkIndex + 1}` : id,
      permissionScope: `knowledge:${snippet.collectionId}`,
    };
  });
}
