import { ThemeSelector } from '@librechat/client';
import { TStartupConfig } from 'librechat-data-provider';
import { ErrorMessage } from '~/components/Auth/ErrorMessage';
import { TranslationKeys, useLocalize } from '~/hooks';
import SocialLoginRender from './SocialLoginRender';
import { BlinkAnimation } from './BlinkAnimation';
import { Banner } from '../Banners';
import Footer from './Footer';

function AuthLayout({
  children,
  header,
  isFetching,
  startupConfig,
  startupConfigError,
  pathname,
  error,
}: {
  children: React.ReactNode;
  header: React.ReactNode;
  isFetching: boolean;
  startupConfig: TStartupConfig | null | undefined;
  startupConfigError: unknown | null | undefined;
  pathname: string;
  error: TranslationKeys | null;
}) {
  const localize = useLocalize();

  const hasStartupConfigError = startupConfigError !== null && startupConfigError !== undefined;
  const DisplayError = () => {
    if (hasStartupConfigError) {
      return (
        <div className="mx-auto sm:max-w-sm">
          <ErrorMessage>{localize('com_auth_error_login_server')}</ErrorMessage>
        </div>
      );
    } else if (error === 'com_auth_error_invalid_reset_token') {
      return (
        <div className="mx-auto sm:max-w-sm">
          <ErrorMessage>
            {localize('com_auth_error_invalid_reset_token')}{' '}
            <a
              className="font-semibold text-accent-primary hover:underline"
              href="/forgot-password"
            >
              {localize('com_auth_click_here')}
            </a>{' '}
            {localize('com_auth_to_try_again')}
          </ErrorMessage>
        </div>
      );
    } else if (error != null && error) {
      return (
        <div className="mx-auto sm:max-w-sm">
          <ErrorMessage>{localize(error)}</ErrorMessage>
        </div>
      );
    }
    return null;
  };

  const appTitle = startupConfig?.appTitle ?? 'Baanzon Chat';

  return (
    <div className="auth-brand-shell relative flex min-h-screen flex-col bg-surface-primary">
      <Banner />
      <div className="flex flex-1 lg:grid lg:grid-cols-[1.05fr_1fr]">
        {/* Brand panel - desktop only. Typographic wordmark until the official
            logo asset replaces client/public/assets/logo.svg. */}
        <aside className="auth-brand-panel relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-14">
          <div className="text-lg font-semibold tracking-tight text-white">
            <span>BAANZON</span>
            <span className="ml-3 text-sm font-medium tracking-[0.35em] text-brand-celadon">
              CHAT
            </span>
          </div>
          <div className="max-w-md">
            <h2 className="text-4xl font-semibold leading-[1.12] tracking-tight text-white xl:text-[2.6rem]">
              {localize('com_auth_brand_headline')}
            </h2>
            <div className="auth-accent-bar mt-5" aria-hidden="true" />
            <p className="mt-4 text-base leading-7 text-white/70">
              {localize('com_auth_brand_subline')}
            </p>
          </div>
          <div className="flex flex-col gap-2 text-sm text-white/55">
            <span>{localize('com_auth_brand_point_1')}</span>
            <span>{localize('com_auth_brand_point_2')}</span>
            <span>{localize('com_auth_brand_point_3')}</span>
          </div>
        </aside>

        {/* Form column */}
        <div className="relative flex flex-col items-center justify-center px-4 py-10">
          <BlinkAnimation active={isFetching}>
            <div className="mb-8 flex h-10 items-center justify-center lg:hidden">
              <img
                src="assets/logo.svg?v=2"
                className="h-full w-auto object-contain"
                alt={localize('com_ui_logo', { 0: appTitle })}
              />
            </div>
          </BlinkAnimation>
          <DisplayError />
          <div className="absolute bottom-0 left-0 md:m-4">
            <ThemeSelector />
          </div>
          <main className="flex w-full flex-grow items-center justify-center sm:max-w-md">
            <div className="auth-card-enter w-authPageWidth overflow-hidden px-1 py-2 sm:rounded-3xl sm:border sm:border-border-light sm:bg-surface-primary sm:px-10 sm:py-10 sm:shadow-[var(--shadow-card)]">
              {!hasStartupConfigError && !isFetching && header && (
                <h1
                  className="mb-6 text-center text-3xl font-semibold tracking-tight text-text-primary"
                  style={{ userSelect: 'none' }}
                >
                  {header}
                </h1>
              )}
              {children}
              {!pathname.includes('2fa') &&
                (pathname.includes('login') || pathname.includes('register')) && (
                  <SocialLoginRender startupConfig={startupConfig} />
                )}
            </div>
          </main>
          <div className="w-full">
            <Footer startupConfig={startupConfig} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default AuthLayout;
