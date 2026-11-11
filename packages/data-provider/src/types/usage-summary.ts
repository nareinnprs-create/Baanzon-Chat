/** All-time usage totals for the signed-in user (`GET /api/usage/summary`). */
export interface TUsageSummary {
  messages: number;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
}
