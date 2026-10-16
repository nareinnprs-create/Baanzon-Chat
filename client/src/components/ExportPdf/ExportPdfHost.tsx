import { useCallback, useEffect, useRef } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useParams } from 'react-router-dom';
import { Constants } from 'librechat-data-provider';
import { useGetConvoIdQuery, useGetMessagesByConvoId } from '~/data-provider';
import {
  exportPdfDialogOpenAtom,
  exportPdfDocumentAtom,
  exportPdfErrorAtom,
  exportPdfScopeAtom,
  exportPdfSelectedMessageIdAtom,
  exportPdfStatusAtom,
} from './state';
import { buildExportDocument } from './citations';
import ExportPdfDialog from './ExportPdfDialog';
import PrintDocument from './PrintDocument';
import { EXPORT_PDF_SHORTCUT, printDocument } from './print';
import { useLocalize } from '~/hooks';

/** Give React a beat to mount the print portal before the OS print dialog reads it. */
function nextTick(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function anyDialogOpen(): boolean {
  const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
  for (let i = 0; i < dialogs.length; i++) {
    const dialog = dialogs[i];
    if (dialog.hasAttribute('inert') || dialog.getAttribute('data-state') === 'closed') {
      continue;
    }
    return true;
  }
  return false;
}

/**
 * Global entry point for the PDF export. Mounted once at the app shell
 * (`Root.tsx`) like the command palette and in-conversation find: it registers
 * the ⌘/Ctrl+Shift+P chord, owns the dialog/print lifecycle, and reads the
 * active conversation's messages only while the dialog is open so a streaming
 * token cannot re-render the shell.
 */
export default function ExportPdfHost() {
  const [open, setOpen] = useAtom(exportPdfDialogOpenAtom);
  const setStatus = useSetAtom(exportPdfStatusAtom);
  const setError = useSetAtom(exportPdfErrorAtom);
  const status = useAtomValue(exportPdfStatusAtom);
  const document = useAtomValue(exportPdfDocumentAtom);
  const { conversationId = '' } = useParams();
  const wasOpen = useRef(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) {
        return;
      }
      if (event.key.toLowerCase() !== EXPORT_PDF_SHORTCUT) {
        return;
      }
      if (anyDialogOpen()) {
        return;
      }
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setOpen]);

  /** A terminal result from a previous run should not greet the next open. */
  useEffect(() => {
    if (open && !wasOpen.current) {
      if (status === 'success' || status === 'error' || status === 'empty') {
        setStatus('idle');
        setError(null);
      }
    }
    wasOpen.current = open;
  }, [open, status, setStatus, setError]);

  /** Leaving the conversation must not leave the dialog armed for the next one. */
  useEffect(() => {
    if (open && conversationId === '') {
      setOpen(false);
    }
  }, [open, conversationId, setOpen]);

  return (
    <>
      {open && conversationId !== '' && (
        <ExportPdfDialogContainer conversationId={conversationId} onChangeOpen={setOpen} />
      )}
      {document != null && <PrintDocument document={document} />}
    </>
  );
}

function ExportPdfDialogContainer({
  conversationId,
  onChangeOpen,
}: {
  conversationId: string;
  onChangeOpen: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { data: messages = [], isLoading } = useGetMessagesByConvoId(conversationId);
  const { data: conversation } = useGetConvoIdQuery(conversationId, {
    enabled: conversationId !== Constants.NEW_CONVO,
  });

  const [scope, setScope] = useAtom(exportPdfScopeAtom);
  const [selectedMessageId, setSelectedMessageId] = useAtom(exportPdfSelectedMessageIdAtom);
  const [status, setStatus] = useAtom(exportPdfStatusAtom);
  const [error, setError] = useAtom(exportPdfErrorAtom);
  const setDocument = useSetAtom(exportPdfDocumentAtom);

  const handleExport = useCallback(async () => {
    if (status === 'preparing' || status === 'printing') {
      return;
    }
    setStatus('preparing');
    setError(null);
    try {
      const builtDocument = buildExportDocument({
        messages,
        scope,
        selectedMessageId,
        title: conversation?.title || localize('com_ui_export_pdf_document_title'),
        localize,
      });
      if (builtDocument.messages.length === 0) {
        setStatus('empty');
        return;
      }
      setDocument(builtDocument);
      await nextTick();
      setStatus('printing');
      await printDocument();
      setStatus('success');
    } catch {
      setError(localize('com_ui_export_pdf_error'));
      setStatus('error');
    } finally {
      setDocument(null);
    }
  }, [
    status,
    messages,
    scope,
    selectedMessageId,
    conversation?.title,
    localize,
    setStatus,
    setError,
    setDocument,
  ]);

  return (
    <ExportPdfDialog
      open={true}
      onOpenChange={(next) => onChangeOpen(next)}
      messages={messages}
      isLoading={isLoading}
      scope={scope}
      onScopeChange={setScope}
      selectedMessageId={selectedMessageId}
      onSelectedMessageChange={setSelectedMessageId}
      status={status}
      error={error}
      onExport={handleExport}
    />
  );
}
