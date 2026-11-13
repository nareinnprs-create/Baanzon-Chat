import { useState } from 'react';
import { Switch, useToastContext } from '@librechat/client';
import { subscribeToPush, unsubscribeFromPush } from '~/lib/webPush';
import { useGetPushConfig } from '~/data-provider';
import { useLocalize } from '~/hooks';

/**
 * Web Push toggle for the General settings tab. Self-gating: renders nothing
 * unless the server reports the feature available (`/api/push` enabled + key).
 */
export default function PushNotificationsToggle() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: pushConfig, isLoading } = useGetPushConfig();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  if (isLoading || pushConfig?.enabled !== true || !pushConfig.publicKey) {
    return null;
  }

  const onToggle = async (checked: boolean) => {
    setBusy(true);
    try {
      if (checked) {
        await subscribeToPush(pushConfig.publicKey!);
        setEnabled(true);
        showToast({ message: localize('com_ui_push_enabled'), status: 'success' });
      } else {
        await unsubscribeFromPush();
        setEnabled(false);
        showToast({ message: localize('com_ui_push_disabled'), status: 'success' });
      }
    } catch (err) {
      const denied = err instanceof Error && err.message === 'Notification permission denied';
      showToast({
        message: localize(
          denied ? 'com_ui_push_permission_denied' : 'com_ui_error_updating_preferences',
        ),
        status: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-between">
      <div>
        <div id="push-notifications-label">{localize('com_ui_push_notifications')}</div>
        <div id="push-notifications-description" className="mt-1 text-xs text-text-secondary">
          {localize('com_ui_push_notifications_description')}
        </div>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={onToggle}
        disabled={busy}
        aria-labelledby="push-notifications-label"
        aria-describedby="push-notifications-description"
      />
    </div>
  );
}
