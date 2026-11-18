import React, { useState } from 'react';
import { useUpdateTrainingConsentMutation, useGetTrainingConsent } from '~/data-provider';
import { useLocalize } from '~/hooks';

/**
 * Account · Data: explicit, revocable opt-in for using conversation content to
 * improve AI models. Play policy requires the consent to be informed and
 * separately withdrawable, which this toggle is.
 */
export default function TrainingConsent() {
  const localize = useLocalize();
  const { data } = useGetTrainingConsent();
  const [checked, setChecked] = useState<boolean | null>(data?.trainingConsent ?? null);
  const [saved, setSaved] = useState(false);
  const mutation = useUpdateTrainingConsentMutation({
    onSuccess: (result) => {
      setChecked(result.trainingConsent);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const current = checked ?? data?.trainingConsent ?? false;
  const toggle = () => {
    setSaved(false);
    mutation.mutate(!current);
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-start gap-3" htmlFor="trainingConsentToggle">
        <input
          id="trainingConsentToggle"
          type="checkbox"
          className="mt-1 size-4 accent-accent-primary"
          checked={current}
          onChange={toggle}
          disabled={mutation.isPending}
        />
        <span className="text-sm text-text-primary">
          {localize('com_ui_settings_training_consent_label')}
        </span>
      </label>
      <p className="text-xs text-text-secondary" id="trainingConsentHint">
        {localize('com_ui_settings_training_consent_hint')}{' '}
        <a
          href="/privacy"
          target="_blank"
          rel="noreferrer"
          className="text-accent-primary hover:underline"
        >
          {localize('com_ui_privacy_policy')}
        </a>
      </p>
      {mutation.isPending && <p className="text-xs text-text-secondary">…</p>}
      {saved && <p className="text-xs text-accent-primary">{localize('com_ui_saved')}</p>}
    </div>
  );
}
