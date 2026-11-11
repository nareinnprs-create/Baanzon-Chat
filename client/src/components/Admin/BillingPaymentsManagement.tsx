import { useState } from 'react';
import { Button, OGDialog, OGDialogTemplate, Spinner, useToastContext } from '@librechat/client';
import type { TAdminDodoPayment } from 'librechat-data-provider';
import {
  useAdminDodoPaymentsQuery,
  useApplyAdminPaymentMutation,
} from '~/data-provider/Admin/BillingPayments';
import { useAuthContext } from '~/hooks/AuthContext';
import { useLocalize } from '~/hooks';

/**
 * Admin view of recent Dodo payments (`GET /api/billing/admin/recent-dodo`)
 * with a webhook-replay action (`POST /api/billing/admin/apply-payment`):
 * when a Dodo webhook delivery failed, the matching succeeded payment can be
 * applied by hand instead of waiting for Dodo's retries.
 */

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function PaymentRow({ payment }: { payment: TAdminDodoPayment }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const apply = useApplyAdminPaymentMutation();

  const tier = payment.metadata?.tier;
  const pack = payment.metadata?.pack;
  const badge = tier ?? pack;

  return (
    <li className="rounded-lg border border-border-light bg-surface-secondary p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-text-primary">{payment.paymentId}</span>
            <span className="rounded-md border border-border-light px-1.5 py-0.5 text-xs text-text-secondary">
              {payment.status}
            </span>
            {badge && (
              <span className="rounded-md border border-border-light px-1.5 py-0.5 text-xs text-text-secondary">
                {badge}
              </span>
            )}
          </div>
          <p className="truncate text-xs text-text-secondary">
            {`${payment.email ?? ''} · ₹${new Intl.NumberFormat().format(payment.amount / 100)} · ${formatDate(payment.createdAt)}`}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={apply.isPending || payment.status !== 'succeeded'}
          onClick={() => setConfirmOpen(true)}
        >
          {localize('com_ui_billing_apply')}
        </Button>
      </div>
      <OGDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <OGDialogTemplate
          title={payment.paymentId}
          showCloseButton={true}
          className="w-11/12 max-w-md"
          main={
            <p className="text-sm text-text-secondary">
              {localize('com_ui_billing_apply_confirm')}
            </p>
          }
          buttons={
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                {localize('com_ui_cancel')}
              </Button>
              <Button
                variant="submit"
                onClick={() => {
                  apply.mutate(
                    { paymentId: payment.paymentId },
                    {
                      onSuccess: (data) => {
                        setConfirmOpen(false);
                        showToast({
                          message: String(
                            localize('com_ui_billing_applied', { '0': data.applied }),
                          ),
                          status: 'success',
                        });
                      },
                      onError: (error) => {
                        showToast({
                          message: error instanceof Error ? error.message : String(error),
                          status: 'error',
                        });
                      },
                    },
                  );
                }}
              >
                {localize('com_ui_billing_apply')}
              </Button>
            </div>
          }
        />
      </OGDialog>
    </li>
  );
}

export default function BillingPaymentsManagement() {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const [isOpen, setIsOpen] = useState(false);
  const isAdmin = user?.role === 'ADMIN';
  const { data, isLoading } = useAdminDodoPaymentsQuery(isAdmin && isOpen);
  const items = data?.items ?? [];

  if (!isAdmin) {
    /** Feature-local UI state only; the component renders for admins. */
    return null;
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
        className="w-full"
      >
        {localize('com_ui_billing_payments')}
      </Button>
      <OGDialog open={isOpen} onOpenChange={setIsOpen}>
        <OGDialogTemplate
          title={localize('com_ui_billing_payments')}
          showCloseButton={true}
          className="w-11/12 max-w-2xl"
          main={
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">{localize('com_ui_billing_recent')}</p>
              {isLoading && (
                <div className="flex grow items-center justify-center p-4">
                  <Spinner className="size-6" />
                </div>
              )}
              {!isLoading && items.length === 0 && (
                <p className="text-sm text-text-secondary">{localize('com_ui_billing_empty')}</p>
              )}
              {!isLoading && items.length > 0 && (
                <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto">
                  {items.map((payment) => (
                    <PaymentRow key={payment.paymentId} payment={payment} />
                  ))}
                </ul>
              )}
            </div>
          }
        />
      </OGDialog>
    </>
  );
}
