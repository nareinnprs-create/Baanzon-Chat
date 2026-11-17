import { useState, type ReactNode } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Button,
  Label,
  Spinner,
} from '@librechat/client';
import type {
  TFeedbackReport,
  TFeedbackReportStatus,
} from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useAllFeedbackReportsQuery, useUpdateFeedbackStatusMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

const STATUS_FILTERS: (TFeedbackReportStatus | 'all')[] = [
  'open',
  'in_progress',
  'resolved',
  'closed',
  'all',
];

const STATUS_VALUES: TFeedbackReportStatus[] = [
  'open',
  'in_progress',
  'resolved',
  'closed',
];

function statusFilterKey(filter: TFeedbackReportStatus | 'all'): TranslationKeys {
  return (
    filter === 'all' ? 'com_ui_feedback_filter_all' : `com_ui_feedback_status_${filter}`
  ) as TranslationKeys;
}

function formatDate(iso?: string): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
}

function FeedbackRow({ report }: { report: TFeedbackReport }) {
  const localize = useLocalize();
  const { mutate: updateStatus } = useUpdateFeedbackStatusMutation();

  return (
    <li className="rounded-lg border border-border-light bg-surface-secondary px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded-md border border-border-light px-1.5 py-0.5 text-xs text-text-secondary">
            {localize(`com_ui_feedback_type_${report.type}` as TranslationKeys)}
          </span>
          <span className="truncate text-sm font-medium text-text-primary">
            {report.subject}
          </span>
        </div>
        <Select
          value={report.status}
          onValueChange={(status: TFeedbackReportStatus) =>
            updateStatus({ id: report.id, patch: { status } })
          }
        >
          <SelectTrigger
            className="h-8 w-36 shrink-0 text-xs"
            aria-label={localize('com_ui_feedback_status_label')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_VALUES.map((status) => (
              <SelectItem key={status} value={status}>
                {localize(`com_ui_feedback_status_${status}` as TranslationKeys)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="mt-1 whitespace-pre-line break-words text-sm text-text-primary">
        {report.message}
      </p>
      <p className="mt-1 truncate text-xs text-text-secondary">
        {`${report.email ?? report.userId ?? ''} · ${formatDate(report.submittedAt)}`}
      </p>
    </li>
  );
}

/**
 * Admin triage queue for in-app feedback reports
 * (`GET /api/feedback/admin`, `PATCH /api/feedback/admin/:id`).
 * The backend list is unpaginated by design; revisit if the queue grows.
 */
export default function FeedbackManagement() {
  const localize = useLocalize();
  const [statusFilter, setStatusFilter] = useState<TFeedbackReportStatus | 'all'>('open');

  const params = statusFilter === 'all' ? {} : { status: statusFilter };
  const { data, isLoading, error } = useAllFeedbackReportsQuery(params);
  const reports = data?.feedback ?? [];

  let body: ReactNode;
  if (isLoading) {
    body = (
      <div className="flex justify-center py-4" role="status">
        <Spinner aria-label={localize('com_ui_feedback_admin')} />
      </div>
    );
  } else if (reports.length === 0) {
    body = (
      <p className="rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-secondary">
        {localize('com_ui_feedback_empty')}
      </p>
    );
  } else {
    body = (
      <ul className="flex flex-col gap-2">
        {reports.map((report) => (
          <FeedbackRow key={report.id} report={report} />
        ))}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Label id="admin-feedback-label">{localize('com_ui_feedback_admin')}</Label>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label={localize('com_ui_feedback_status_label')}
      >
        {STATUS_FILTERS.map((filter) => (
          <Button
            key={filter}
            variant={statusFilter === filter ? 'default' : 'outline'}
            aria-pressed={statusFilter === filter}
            onClick={() => setStatusFilter(filter)}
            className="h-8 px-3 text-xs"
          >
            {localize(statusFilterKey(filter))}
          </Button>
        ))}
      </div>
      {error != null && (
        <p className="text-sm text-text-destructive" role="alert">
          {localize('com_ui_feedback_error')}
        </p>
      )}
      {body}
    </div>
  );
}
