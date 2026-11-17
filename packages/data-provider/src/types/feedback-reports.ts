/** In-app user feedback reports (distinct from per-message feedback tags). */
export type TFeedbackReportType = 'bug' | 'feature' | 'improvement' | 'general';

export type TFeedbackReportStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

/** Wire shape of `GET /api/feedback` rows; ids are strings, dates ISO-8601. */
export interface TFeedbackReport {
  id: string;
  userId?: string;
  email?: string;
  type: TFeedbackReportType;
  subject: string;
  message: string;
  rating?: number;
  submittedAt?: string;
  status: TFeedbackReportStatus;
  processedBy?: string;
  tenantId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** `POST /api/feedback` body; the server attributes the report to the caller. */
export interface TCreateFeedbackReport {
  type: TFeedbackReportType;
  subject: string;
  message: string;
  rating?: number;
}

/** `PATCH /api/feedback/admin/:id` body; only triage fields are mutable. */
export interface TUpdateFeedbackReport {
  status?: TFeedbackReportStatus;
}

export interface TFeedbackReportListParams {
  type?: TFeedbackReportType;
  status?: TFeedbackReportStatus;
}

export type TFeedbackReportsResponse = { feedback: TFeedbackReport[] };
