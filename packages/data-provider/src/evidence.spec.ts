import { evidenceSourceSchema, EVIDENCE_SOURCE_TYPES } from './evidence';

describe('evidence sources', () => {
  it('supports every provenance class', () => {
    expect(EVIDENCE_SOURCE_TYPES).toContain('private_document');
    expect(EVIDENCE_SOURCE_TYPES).toContain('live_web');
    expect(EVIDENCE_SOURCE_TYPES).toContain('unverified_speculation');
  });

  it('requires stable identity and valid confidence', () => {
    expect(evidenceSourceSchema.safeParse({ id: 'doc:1', type: 'private_document' }).success).toBe(
      true,
    );
    expect(evidenceSourceSchema.safeParse({ id: '', type: 'private_document' }).success).toBe(
      false,
    );
    expect(
      evidenceSourceSchema.safeParse({ id: 'doc:1', type: 'private_document', confidence: 2 })
        .success,
    ).toBe(false);
  });
});
