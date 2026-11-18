import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Spinner } from '@librechat/client';
import { AlertCircle, Sparkles } from 'lucide-react';
import type { TPlayProduct } from 'librechat-data-provider';
import { QueryKeys } from 'librechat-data-provider';
import {
  useBillingPlayProducts,
  useVerifyBillingPlayPurchase,
} from '~/data-provider';
import { useLocalize } from '~/hooks';

/** The Play Billing service origin for the Digital Goods API inside a TWA. */
const PLAY_SERVICE = 'https://play.google.com/billing';

type DigitalGoodsService = {
  getDetails(skus: string[]): Promise<Array<{ itemId: string; title: string; prices: { price: string }[] }>>;
  purchase(sku: string): Promise<{ purchaseToken: string; signature?: string }>;
};

async function getPlayService(): Promise<DigitalGoodsService | null> {
  if (typeof window === 'undefined' || !('getDigitalGoodsService' in window)) {
    return null;
  }
  try {
    return (await (window as unknown as {
      getDigitalGoodsService: (origin: string) => Promise<DigitalGoodsService>;
    }).getDigitalGoodsService(PLAY_SERVICE)) as DigitalGoodsService;
  } catch {
    return null;
  }
}

type PlayDetail = { itemId: string; title: string; price: string };

export default function PlayBilling() {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const productsQuery = useBillingPlayProducts();
  const verify = useVerifyBillingPlayPurchase();
  const [service, setService] = useState<DigitalGoodsService | null>(null);
  const [serviceChecked, setServiceChecked] = useState(false);
  const [details, setDetails] = useState<PlayDetail[]>([]);
  const [busySku, setBusySku] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void getPlayService().then((svc) => {
      if (cancelled) {
        return;
      }
      setService(svc);
      setServiceChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const skus = (productsQuery.data?.items ?? []).map((p: TPlayProduct) => p.sku);
  useEffect(() => {
    if (!service || skus.length === 0) {
      return;
    }
    let cancelled = false;
    void service
      .getDetails(skus)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setDetails(
          result.map((d) => ({
            itemId: d.itemId,
            title: d.title,
            price: d.prices?.[0]?.price ?? '',
          })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [service, skus.join(',')]);

  const priceFor = (sku: string): string => details.find((d) => d.itemId === sku)?.price ?? '';

  const buy = async (product: TPlayProduct) => {
    if (!service) {
      return;
    }
    setBusySku(product.sku);
    setError('');
    try {
      const result = await service.purchase(product.sku);
      await verify.mutateAsync(
        { purchaseToken: result.purchaseToken, productId: product.sku },
        {
          onSuccess: () => {
            void queryClient.invalidateQueries([QueryKeys.billingSubscription]);
          },
        },
      );
    } catch (e) {
      setError((e as Error)?.message || localize('com_ui_checkout_error'));
    } finally {
      setBusySku('');
    }
  };

  if (serviceChecked && !service) {
    // No Play Billing service (sideload, browser): fall back to the web hint.
    return (
      <p className="mt-3 flex items-center gap-2 rounded-md border border-border-light p-3 text-sm text-text-secondary">
        <AlertCircle className="icon-md" aria-hidden="true" />
        {localize('com_ui_pricing_on_web')}
      </p>
    );
  }

  const products = productsQuery.data?.items ?? [];
  const labelFor = (sku: string): string =>
    products.find((p) => p.sku === sku)?.kind === 'pack'
      ? localize('com_ui_pricing_topup')
      : localize('com_ui_pricing_subscribe');

  return (
    <div className="mt-4 flex flex-col gap-3">
      {error && (
        <p className="flex items-center gap-2 rounded-md border border-border-light p-3 text-sm text-text-primary">
          <AlertCircle className="icon-md" aria-hidden="true" />
          {error}
        </p>
      )}
      {productsQuery.isLoading || !serviceChecked ? (
        <div className="flex min-h-24 items-center justify-center">
          <Spinner aria-label={localize('com_ui_pricing_loading')} />
        </div>
      ) : (
        products.map((product) => (
          <div
            key={product.sku}
            className="flex items-center justify-between gap-3 rounded-lg border border-border-light bg-surface-primary p-4"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-text-primary">{priceFor(product.sku) || product.sku}</p>
            </div>
            <Button
              variant="outline"
              onClick={() => void buy(product)}
              disabled={busySku === product.sku}
            >
              {busySku === product.sku ? (
                <Spinner />
              ) : (
                <>
                  <Sparkles className="icon-md" aria-hidden="true" />
                  {labelFor(product.sku)}
                </>
              )}
            </Button>
          </div>
        ))
      )}
    </div>
  );
}
