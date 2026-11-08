import { atom } from 'jotai';
import type { TTrustResponse } from 'librechat-data-provider';

/**
 * The latest trust verdict fetched through the `useTrust` query hook, held so
 * a TrustIndicator badge can render while its react-query call is in flight
 * elsewhere. There is no fabricated default: with no verdict fetched the atom
 * stays `null`, and a feature-local placeholder state mirrors that honestly
 * instead of claiming a state we have not scored.
 */
export const trustAtom = atom<TTrustResponse | null>(null);
