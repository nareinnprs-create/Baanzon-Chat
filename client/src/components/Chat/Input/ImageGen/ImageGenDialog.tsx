import { useEffect, useId, useState } from 'react';
import { Download } from 'lucide-react';
import {
  Button,
  OGDialog,
  OGDialogClose,
  OGDialogContent,
  OGDialogHeader,
  OGDialogTitle,
  Textarea,
} from '@librechat/client';
import useFileUploadRouter from '~/hooks/Files/useFileUploadRouter';
import { useLocalize } from '~/hooks';

/**
 * V4 image generation entry: prompts for a description, calls the tier-gated
 * `/api/images/generate` endpoint (flux via CF Workers AI - see
 * api/server/routes/images-generate.js), and previews the returned image. The
 * server's own messages (daily cap, burst limit, not-configured) surface in
 * the dialog. "Add to message" hands the blob to the standard file pipeline,
 * so it uploads and attaches like any picked image.
 */
export default function ImageGenDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const localize = useLocalize();
  const attachFiles = useFileUploadRouter();
  const fieldId = useId();
  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ blob: Blob; url: string; mime: string } | null>(null);

  useEffect(() => {
    return () => {
      if (result) {
        URL.revokeObjectURL(result.url);
      }
    };
  }, [result]);

  const generate = async () => {
    const text = prompt.trim();
    if (!text || running) {
      return;
    }
    setRunning(true);
    setError('');
    try {
      const res = await fetch('/api/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text }),
      });
      if (!res.ok) {
        let message = localize('com_ui_image_gen_generate');
        try {
          const data = await res.json();
          if (typeof data?.message === 'string') {
            message = data.message;
          }
        } catch {
          // keep the generic message
        }
        setError(message);
        return;
      }
      const blob = await res.blob();
      if (result) {
        URL.revokeObjectURL(result.url);
      }
      setResult({ blob, url: URL.createObjectURL(blob), mime: blob.type || 'image/png' });
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setRunning(false);
    }
  };

  const addToMessage = () => {
    if (!result) {
      return;
    }
    let extension = 'img';
    if (result.mime.includes('jpeg')) {
      extension = 'jpg';
    } else if (result.mime.includes('png')) {
      extension = 'png';
    }
    const file = new File([result.blob], `baanzon-image-${Date.now()}.${extension}`, {
      type: result.mime,
    });
    attachFiles([file]);
    onClose();
  };

  const download = () => {
    if (!result) {
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = result.url;
    anchor.download = `baanzon-image-${Date.now()}.png`;
    anchor.click();
  };

  return (
    <OGDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <OGDialogContent className="w-11/12 max-w-xl" showCloseButton={false}>
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_ui_image_gen')}</OGDialogTitle>
        </OGDialogHeader>
        <Textarea
          id={fieldId}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          aria-label={localize('com_ui_image_gen_prompt')}
          placeholder={localize('com_ui_image_gen_prompt')}
          className="min-h-20"
          disabled={running}
        />
        {error != null && error !== '' && (
          <p role="alert" className="text-sm text-status-error">
            {error}
          </p>
        )}
        {result && (
          <img
            src={result.url}
            alt={prompt.trim()}
            className="max-h-80 w-full rounded-lg border border-border-medium object-contain"
          />
        )}
        <div className="flex justify-end gap-2 pt-4">
          {result && (
            <>
              <Button variant="outline" onClick={download}>
                <Download className="mr-1 h-4 w-4" aria-hidden="true" />
                {localize('com_ui_download')}
              </Button>
              <Button variant="default" onClick={addToMessage}>
                {localize('com_ui_image_gen_add')}
              </Button>
            </>
          )}
          <OGDialogClose asChild>
            <Button variant="outline">{localize('com_ui_cancel')}</Button>
          </OGDialogClose>
          <Button variant="default" disabled={running || prompt.trim() === ''} onClick={generate}>
            {running
              ? localize('com_ui_image_gen_generate') + '…'
              : localize('com_ui_image_gen_generate')}
          </Button>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
