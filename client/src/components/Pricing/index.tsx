import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Spinner } from '@librechat/client';
import { AlertCircle, Sparkles } from 'lucide-react';
import type { TCheckoutRequest, TPlanProduct, TPackProduct } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useBillingProducts, useCreateCheckout } from '~/data-provider';
import { useDocumentTitle, useLocalize } from '~/hooks';
import { cn } from '~/utils';

type Cycle = 'monthly' | 'yearly';

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-lg border border-border-light bg-surface-primary p-5',
        className,
      )}
    >
      {children}
    </section>
  );
}

function CycleToggle({ cycle, setCycle }: { cycle: Cycle; setCycle: (cycle: Cycle) => void }) {
  const localize = useLocalize();
  const options: { value: Cycle; labelKey: TranslationKeys }[] = [
    { value: 'monthly', labelKey: 'com_ui_pricing_monthly' },
    { value: 'yearly', labelKey: 'com_ui_pricing_yearly' },
  ];
  return (
    <div role="radiogroup" aria-label={localize('com_ui_pricing_cycle')} className="flex gap-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={cycle === option.value}
          onClick={() => setCycle(option.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm transition-colors',
            cycle === option.value
              ? 'bg-surface-active-alt text-text-primary'
              : 'text-text-secondary hover:bg-surface-hover',
          )}
        >
          {localize(option.labelKey)}
        </button>
      ))}
    </div>
  );
}

function ProductCard({
  product,
  cycle,
  onBuy,
  busy,
}: {
  product: TPlanProduct;
  cycle: Cycle;
  onBuy: (payload: TCheckoutRequest) => void;
  busy: boolean;
}) {
  const localize = useLocalize();
  const yearlyPrice = product.inrYearly;
  const yearly = yearlyPrice != null;
  const price = cycle === 'yearly' && yearly ? yearlyPrice : product.inrMonthly;
  return (
    <Card className="flex-1 basis-64">
      <h3 className="text-base font-medium text-text-primary">{product.label}</h3>
      <p className="text-2xl text-text-primary">
        {`₹${new Intl.NumberFormat().format(price)}`}
        <span className="text-sm text-text-secondary">
          {cycle === 'yearly' && yearly
            ? ` ${localize('com_ui_pricing_per_year')}`
            : ` ${localize('com_ui_pricing_per_month')}`}
        </span>
      </p>
      {yearly && (
        <p className="text-xs text-text-secondary">
          {`₹${new Intl.NumberFormat().format(product.inrMonthly)} ${localize('com_ui_pricing_per_month')}`}
        </p>
      )}
      <Button
        variant="submit"
        onClick={() => onBuy({ tier: product.tier, cycle })}
        disabled={busy}
        className="mt-auto"
      >
        {busy ? localize('com_ui_pricing_redirecting') : localize('com_ui_pricing_subscribe')}
      </Button>
    </Card>
  );
}

function PackCard({
  pack,
  onBuy,
  busy,
}: {
  pack: TPackProduct;
  onBuy: (payload: TCheckoutRequest) => void;
  busy: boolean;
}) {
  const localize = useLocalize();
  return (
    <Card className="flex-1 basis-64">
      <h3 className="flex items-center gap-2 text-base font-medium text-text-primary">
        <Sparkles className="icon-md" aria-hidden="true" />
        {pack.label}
      </h3>
      <p className="text-2xl text-text-primary">{`₹${new Intl.NumberFormat().format(pack.inr)}`}</p>
      <p className="text-sm text-text-secondary">
        {`${new Intl.NumberFormat().format(pack.credits)} ${localize('com_ui_pricing_credits')}`}
      </p>
      <Button
        variant="outline"
        onClick={() => onBuy({ pack: pack.pack })}
        disabled={busy}
        className="mt-auto"
      >
        {busy ? localize('com_ui_pricing_redirecting') : localize('com_ui_pricing_topup')}
      </Button>
    </Card>
  );
}

/** The purchase surface the backend billing routes already serve: the public
 *  catalog from `GET /api/billing/products`, and Dodo hosted checkout opened by
 *  `POST /api/billing/checkout` for one plan subscription or one credit pack. */
export function PricingView() {
  const localize = useLocalize();
  useDocumentTitle(localize('com_nav_pricing'));
  const [searchParams] = useSearchParams();
  const mockPack = searchParams.get('mock_checkout');
  const [cycle, setCycle] = useState<Cycle>('monthly');
  const [error, setError] = useState('');
  const productsQuery = useBillingProducts();
  const checkout = useCreateCheckout();

  const buy = (payload: TCheckoutRequest) => {
    setError('');
    checkout.mutate(payload, {
      onSuccess: (data) => window.location.assign(data.url),
      onError: () => setError(localize('com_ui_checkout_error')),
    });
  };

  const busy = checkout.isPending;
  const products = productsQuery.data?.products ?? [];
  const packs = productsQuery.data?.packs ?? [];
  const hasYearly = products.some((product) => product.inrYearly != null);

  return (
    <div className="mx-auto w-full max-w-3xl p-4">
      <div role="region" aria-label={localize('com_ui_pricing_title')}>
        <h1 className="text-xl font-semibold text-text-primary">
          {localize('com_ui_pricing_title')}
        </h1>
        <p className="mt-1 text-sm text-text-secondary">{localize('com_ui_pricing_subtitle')}</p>
      </div>

      {mockPack != null && (
        <p className="mt-3 flex items-center gap-2 rounded-md border border-border-light p-3 text-sm text-text-secondary">
          <AlertCircle className="icon-md" aria-hidden="true" />
          {localize('com_ui_pricing_mock_note')}
        </p>
      )}

      {error != null && error !== '' && (
        <p className="mt-3 flex items-center gap-2 rounded-md border border-border-light p-3 text-sm text-text-primary">
          <AlertCircle className="icon-md" aria-hidden="true" />
          {error}
        </p>
      )}

      {productsQuery.isLoading ? (
        <div className="mt-6 flex min-h-40 items-center justify-center">
          <Spinner aria-label={localize('com_ui_pricing_loading')} />
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-text-secondary">
              {localize('com_ui_pricing_plans')}
            </h2>
            {hasYearly && <CycleToggle cycle={cycle} setCycle={setCycle} />}
          </div>
          <div className="mt-3 flex flex-wrap gap-4">
            {products.map((product) => (
              <ProductCard
                key={product.tier}
                product={product}
                cycle={cycle}
                onBuy={buy}
                busy={busy}
              />
            ))}
          </div>

          <h2 className="mt-8 text-sm font-medium text-text-secondary">
            {localize('com_ui_pricing_packs')}
          </h2>
          <div className="mt-3 flex flex-wrap gap-4">
            {packs.map((pack) => (
              <PackCard key={pack.pack} pack={pack} onBuy={buy} busy={busy} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default PricingView;
