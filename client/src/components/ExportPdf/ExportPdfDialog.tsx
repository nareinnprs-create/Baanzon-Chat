import { useId, useMemo } from 'react';
import { FileText, Printer } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TMessage } from 'librechat-data-provider';
import {
  Alert,
  Button,
  Dropdown,
  EmptyState,
  OGDialog,
  OGDialogTemplate,
  Radio,
  Spinner,
} from '@librechat/client';
import type { ExportPdfScope, ExportPdfStatus } from './types';
import { linearizeThread } from './citations';
import { useLocalize } from '~/hooks';

type ExportPdfDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The active thread's messages; the dialog linearizes and labels them. */
  messages: TMessage[];
  isLoading?: boolean;
  scope: ExportPdfScope;
  onScopeChange: (scope: ExportPdfScope) => void;
  selectedMessageId: string | null;
  onSelectedMessageChange: (messageId: string) => void;
  status: ExportPdfStatus;
  error?: string | null;
  onExport: () => void;
};

const OPTION_TEXT_LIMIT = 72;

/**
 * Presentational export dialog. It owns only the markup and its open state via
 * the parent; scope, selection, status and the print run all arrive as props so
 * the dialog can be tested without the data layer.
 */
export default function ExportPdfDialog({
  open,
  onOpenChange,
  messages,
  isLoading = false,
  scope,
  onScopeChange,
  selectedMessageId,
  onSelectedMessageChange,
  status,
  error,
  onExport,
}: ExportPdfDialogProps) {
  const localize = useLocalize();
  const scopeLabelId = useId();

  const thread = useMemo(() => linearizeThread(messages), [messages]);

  const messageOptions = useMemo(
    () =>
      thread.map((message) => {
        const sender = message.isCreatedByUser
          ? localize('com_ui_user')
          : message.sender || localize('com_ui_assistant');
        const text = (message.text ?? '').replace(/\s+/g, ' ').trim();
        const preview =
          text.length > OPTION_TEXT_LIMIT ? `${text.slice(0, OPTION_TEXT_LIMIT)}…` : text;
        return { value: message.messageId ?? '', label: `${sender}: ${preview}` };
      }),
    [thread, localize],
  );

  const isEmpty = !isLoading && messages.length === 0;
  const busy = status === 'preparing' || status === 'printing';
  const canExport =
    !isLoading &&
    !isEmpty &&
    !busy &&
    (scope === 'conversation' || (selectedMessageId != null && selectedMessageId !== ''));

  const scopeOptions = [
    { value: 'conversation', label: localize('com_ui_export_pdf_scope_conversation') },
    { value: 'message', label: localize('com_ui_export_pdf_scope_message') },
  ];

  const selection = (
    <Button
      type="button"
      variant="default"
      onClick={onExport}
      disabled={!canExport}
      aria-label={localize('com_ui_export_pdf_action')}
      data-testid="export-pdf-run"
    >
      {busy ? <Spinner className="size-4" /> : <Printer className="size-4" aria-hidden="true" />}
      {localize('com_ui_export_pdf_action')}
    </Button>
  );

  let statusRegion: ReactNode = null;
  if (busy) {
    statusRegion = (
      <p
        role="status"
        className="flex items-center gap-2 text-sm text-text-secondary"
        data-testid="export-pdf-status"
      >
        <Spinner className="size-4" aria-hidden="true" />
        {status === 'preparing'
          ? localize('com_ui_export_pdf_preparing')
          : localize('com_ui_export_pdf_printing')}
      </p>
    );
  } else if (status === 'success') {
    statusRegion = (
      <Alert variant="success" data-testid="export-pdf-status">
        {localize('com_ui_export_pdf_success')}
      </Alert>
    );
  } else if (status === 'empty') {
    statusRegion = (
      <Alert variant="warning" data-testid="export-pdf-status">
        {localize('com_ui_export_pdf_empty')}
      </Alert>
    );
  } else if (status === 'error') {
    statusRegion = (
      <Alert variant="error" data-testid="export-pdf-status">
        <div className="flex flex-col gap-2">
          <span>{error || localize('com_ui_export_pdf_error')}</span>
          <div>
            <Button type="button" variant="outline" size="sm" onClick={onExport}>
              {localize('com_ui_retry')}
            </Button>
          </div>
        </div>
      </Alert>
    );
  }

  let main: ReactNode = null;
  if (isLoading) {
    main = (
      <p role="status" className="flex items-center gap-2 px-1 py-4 text-sm text-text-secondary">
        <Spinner className="size-4" aria-hidden="true" />
        {localize('com_ui_loading')}
      </p>
    );
  } else if (isEmpty) {
    main = (
      <EmptyState
        icon={FileText}
        title={localize('com_ui_export_pdf_empty_title')}
        description={localize('com_ui_export_pdf_empty')}
      />
    );
  } else {
    main = (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span id={scopeLabelId} className="text-sm font-medium text-text-primary">
            {localize('com_ui_export_pdf_scope')}
          </span>
          <Radio
            options={scopeOptions}
            value={scope}
            onChange={(value) => onScopeChange(value as ExportPdfScope)}
            disabled={busy}
            fullWidth
            aria-labelledby={scopeLabelId}
          />
        </div>
        {scope === 'message' && (
          <div className="flex flex-col gap-2" data-testid="export-pdf-message-select">
            <span className="text-sm font-medium text-text-primary">
              {localize('com_ui_export_pdf_select_message')}
            </span>
            <Dropdown
              value={selectedMessageId ?? ''}
              onChange={onSelectedMessageChange}
              options={messageOptions}
              ariaLabel={localize('com_ui_export_pdf_select_message')}
              disabled={busy || messageOptions.length === 0}
              sizeClasses="w-full"
              testId="export-pdf-message-dropdown"
            />
          </div>
        )}
        {statusRegion}
      </div>
    );
  }

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_ui_export_pdf_title')}
        description={localize('com_ui_export_pdf_description')}
        main={main}
        buttons={selection}
        showCancelButton={true}
        mainClassName="px-6"
      />
    </OGDialog>
  );
}
