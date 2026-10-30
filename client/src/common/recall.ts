/** X8 cross-chat recall hit (GET /api/recall). */
export interface TRecallHit {
  conversationId: string;
  title: string;
  snippet: string;
  updatedAt?: string;
}
