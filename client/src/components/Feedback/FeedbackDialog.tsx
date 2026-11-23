import React, { useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import {
  OGDialog,
  OGDialogContent,
  OGDialogHeader,
  OGDialogTitle,
  OGDialogTrigger,
  Button,
  Label,
  Input,
  Textarea,
  Spinner,
  useToastContext,
} from '@librechat/client';
import type { TCreateFeedbackReport, TFeedbackReportType } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useCreateFeedbackReportMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

const TYPE_KEYS: { value: TFeedbackReportType; labelKey: TranslationKeys }[] = [
  { value: 'bug', labelKey: 'com_ui_feedback_type_bug' },
  { value: 'improvement', labelKey: 'com_ui_feedback_type_improvement' },
  { value: 'feature', labelKey: 'com_ui_feedback_type_feature' },
  { value: 'general', labelKey: 'com_ui_feedback_type_general' },
];

const SUBJECT_MAX = 300;
const MESSAGE_MAX = 4000;

/** Settings row + dialog where any user reports an issue or shares an idea. */
export default function FeedbackDialog() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<TFeedbackReportType>('bug');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const { mutate: submit, isLoading: submitting } = useCreateFeedbackReportMutation();

  const canSubmit = subject.trim().length > 0 && message.trim().length > 0 && !submitting;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    const payload: TCreateFeedbackReport = {
      type,
      subject: subject.trim(),
      message: message.trim(),
    };
    submit(payload, {
      onSuccess: () => {
        setOpen(false);
        setSubject('');
        setMessage('');
        showToast({ message: localize('com_ui_feedback_success'), status: 'success' });
      },
      onError: () => {
        showToast({ message: localize('com_ui_feedback_error'), status: 'error' });
      },
    });
  };

  return (
    <OGDialog open={open} onOpenChange={setOpen}>
      <div className="flex items-center justify-between">
        <Label id="feedback-label">{localize('com_ui_feedback_entry')}</Label>
        <OGDialogTrigger asChild>
          <Button aria-labelledby="feedback-label" variant="outline" onClick={() => setOpen(true)}>
            <MessageSquarePlus className="size-4" aria-hidden="true" />
            {localize('com_ui_feedback_title')}
          </Button>
        </OGDialogTrigger>
      </div>
      <OGDialogContent className="w-11/12 max-w-md">
        <OGDialogHeader>
          <OGDialogTitle className="text-lg font-medium leading-6">
            {localize('com_ui_feedback_title')}
          </OGDialogTitle>
        </OGDialogHeader>
        <form onSubmit={handleSubmit}>
          <div
            className="mb-4 flex flex-wrap gap-2"
            role="group"
            aria-label={localize('com_ui_feedback_type_label')}
          >
            {TYPE_KEYS.map(({ value, labelKey }) => (
              <Button
                key={value}
                type="button"
                variant={type === value ? 'default' : 'outline'}
                aria-pressed={type === value}
                onClick={() => setType(value)}
                className="h-8 px-3 text-xs"
              >
                {localize(labelKey)}
              </Button>
            ))}
          </div>
          <div className="mb-4">
            <Label className="mb-1 text-sm font-medium" htmlFor="feedback-subject">
              {localize('com_ui_feedback_subject_label')}
            </Label>
            <Input
              id="feedback-subject"
              value={subject}
              maxLength={SUBJECT_MAX}
              placeholder={localize('com_ui_feedback_subject_placeholder')}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div className="mb-4">
            <Label className="mb-1 text-sm font-medium" htmlFor="feedback-message">
              {localize('com_ui_feedback_message_label')}
            </Label>
            <Textarea
              id="feedback-message"
              value={message}
              maxLength={MESSAGE_MAX}
              rows={5}
              placeholder={localize('com_ui_feedback_message_placeholder')}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <Button type="submit" variant="submit" className="w-full" disabled={!canSubmit}>
            {submitting ? (
              <div className="flex h-6 justify-center">
                <Spinner className="icon-sm m-auto" />
              </div>
            ) : (
              localize('com_ui_feedback_submit')
            )}
          </Button>
        </form>
      </OGDialogContent>
    </OGDialog>
  );
}
