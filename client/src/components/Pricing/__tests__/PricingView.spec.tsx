import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { TBillingProductsResponse } from 'librechat-data-provider';
import { PricingView } from '../index';

jest.mock('~/utils/fullPageRedirect', () => ({ redirectTo: jest.fn() }));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useDocumentTitle: jest.fn(),
}));

jest.mock('~/data-provider', () => {
  const checkoutApi = { mutate: jest.fn(), isPending: false };
  return {
    useBillingProducts: jest.fn(),
    useBillingSubscription: jest.fn(),
    useBillingPlayProducts: () => ({ data: undefined, isLoading: false }),
    useVerifyBillingPlayPurchase: () => ({ mutate: jest.fn(), isPending: false }),
    useCreateCheckout: () => checkoutApi,
  };
});

const { useBillingProducts, useBillingSubscription, useCreateCheckout } = jest.requireMock(
  '~/data-provider',
) as {
  useBillingProducts: jest.Mock;
  useBillingSubscription: jest.Mock;
  useCreateCheckout: () => { mutate: jest.Mock; isPending: boolean };
};
let checkoutApi: { mutate: jest.Mock; isPending: boolean };

const catalog: TBillingProductsResponse = {
  products: [
    { tier: 'lite', label: 'Lite', inrMonthly: 499, inrYearly: 4990 },
    { tier: 'pro', label: 'Pro', inrMonthly: 999, inrYearly: null },
  ],
  packs: [{ pack: 'lite_pack', label: 'Lite pack', inr: 99, credits: 200 }],
};

const renderView = () =>
  render(
    <MemoryRouter initialEntries={['/pricing']}>
      <QueryClientProvider client={new QueryClient()}>
        <PricingView />
      </QueryClientProvider>
    </MemoryRouter>,
  );

describe('PricingView', () => {
  beforeEach(() => {
    localStorage.removeItem('baanzon_android_app');
    checkoutApi = useCreateCheckout() as { mutate: jest.Mock; isPending: boolean };
    checkoutApi.mutate.mockReset();
    checkoutApi.mutate.mockImplementation(
      (_payload: unknown, options?: { onSuccess?: (d: unknown) => void }) => {
        options?.onSuccess?.({ url: 'https://checkout.example.com/session' });
      },
    );
    useBillingProducts.mockReturnValue({ data: catalog, isLoading: false });
    useBillingSubscription.mockReturnValue({ data: undefined });
  });

  it('renders the catalog tiers and credit packs with their INR prices', () => {
    renderView();

    expect(screen.getByText('Lite')).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('Lite pack')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'com_ui_pricing_subscribe' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'com_ui_pricing_topup' })).toBeInTheDocument();
    expect(screen.getByText('200 com_ui_pricing_credits')).toBeInTheDocument();
  });

  it('marks the caller\u2019s current tier from the subscription summary', () => {
    useBillingSubscription.mockReturnValue({ data: { tier: 'lite', status: 'active' } });
    renderView();

    const badges = screen.getAllByText('com_ui_pricing_current_plan');
    expect(badges).toHaveLength(1);
    expect(badges[0].closest('section')?.textContent).toContain('Lite');
  });

  it('shows no current-plan badge without a subscription summary', () => {
    renderView();

    expect(screen.queryByText('com_ui_pricing_current_plan')).not.toBeInTheDocument();
  });

  it('buys a pack through checkout with the pack payload', async () => {
    renderView();

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_pricing_topup' }));

    await waitFor(() =>
      expect(checkoutApi.mutate).toHaveBeenCalledWith({ pack: 'lite_pack' }, expect.anything()),
    );
  });

  it('subscribes to a tier under the selected billing cycle', () => {
    renderView();

    fireEvent.click(screen.getByRole('radio', { name: 'com_ui_pricing_yearly' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'com_ui_pricing_subscribe' })[0]);

    expect(checkoutApi.mutate).toHaveBeenCalledWith(
      { tier: 'lite', cycle: 'yearly' },
      expect.anything(),
    );
  });

  it('renders no web purchase surface inside the Android app', () => {
    localStorage.setItem('baanzon_android_app', '1');
    renderView();

    /* The TWA branch returns PlayBilling before the web catalog, so the web
     * subscribe/top-up buttons and the checkout mutation must be absent. */
    expect(
      screen.queryByRole('button', { name: 'com_ui_pricing_subscribe' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'com_ui_pricing_topup' })).not.toBeInTheDocument();
    expect(checkoutApi.mutate).not.toHaveBeenCalled();
  });
});
