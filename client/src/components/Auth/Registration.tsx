import React, { useContext, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { loginPage } from 'librechat-data-provider';
import { Turnstile } from '@marsidev/react-turnstile';
import { useNavigate, useOutletContext, useLocation } from 'react-router-dom';
import { useRegisterUserMutation } from 'librechat-data-provider/react-query';
import { ThemeContext, SecretInput, Spinner, Button, Input, isDark } from '@librechat/client';
import {
  getCountries,
  getCountryCallingCode,
  isValidPhoneNumber,
  type CountryCode,
} from 'libphonenumber-js';
import type { TRegisterUser, TError } from 'librechat-data-provider';
import type { TLoginLayoutContext } from '~/common';
import { useLocalize, TranslationKeys } from '~/hooks';
import { ErrorMessage } from './ErrorMessage';

type TRegistrationFormValues = TRegisterUser & { phoneNational: string };

/** Fallback matches the deployment's primary audience; overridden by the browser locale. */
const DEFAULT_COUNTRY: CountryCode = 'IN';

const Registration: React.FC = () => {
  const navigate = useNavigate();
  const localize = useLocalize();
  const { theme } = useContext(ThemeContext);
  const { startupConfig, startupConfigError, isFetching } = useOutletContext<TLoginLayoutContext>();

  const {
    watch,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TRegistrationFormValues>({ mode: 'onChange' });
  const password = watch('password');

  const region = navigator.language.split('-')[1];
  const [country, setCountry] = useState<CountryCode>(
    region && getCountries().includes(region as CountryCode) ? (region as CountryCode) : DEFAULT_COUNTRY,
  );
  // Ref keeps the live country reachable from callbacks RHF may have captured earlier.
  const countryRef = useRef(country);
  countryRef.current = country;
  const displayNames = useMemo(
    () => new Intl.DisplayNames([navigator.language], { type: 'region' }),
    [],
  );
  const countryOptions = useMemo(
    () =>
      getCountries()
        .map((code) => ({
          code,
          dial: getCountryCallingCode(code),
          name: displayNames.of(code) ?? code,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [displayNames],
  );
  const dial = getCountryCallingCode(country);

  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [countdown, setCountdown] = useState<number>(3);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const token = queryParams.get('token');
  const validTheme = isDark(theme) ? 'dark' : 'light';

  // only require captcha if we have a siteKey
  const requireCaptcha = Boolean(startupConfig?.turnstile?.siteKey);
  const authInputClassName =
    'webkit-dark-styles transition-color peer h-auto w-full rounded-2xl border border-border-light bg-surface-primary px-3.5 pb-2.5 pt-3 text-text-primary duration-200 hover:border-border-light focus:border-accent-primary focus:outline-none focus-visible:border-accent-primary';
  const authSecretInputClassName = `${authInputClassName} pr-12`;
  const authLabelClassName =
    'absolute start-3 top-1.5 z-10 origin-[0] -translate-y-4 scale-75 transform bg-surface-primary px-2 text-sm text-text-secondary-alt duration-200 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:scale-100 peer-focus:top-1.5 peer-focus:-translate-y-4 peer-focus:scale-75 peer-focus:px-2 peer-focus:text-accent-primary rtl:peer-focus:left-auto rtl:peer-focus:translate-x-1/4';
  const authSecretButtonClassName =
    'size-9 rounded-xl text-text-secondary-alt hover:bg-transparent hover:text-text-primary';
  // Label for a control that always holds a value (country select), so it sits floated permanently.
  const authStaticLabelClassName =
    'absolute start-3 top-1.5 z-10 origin-[0] -translate-y-4 scale-75 transform bg-surface-primary px-2 text-sm text-text-secondary-alt';

  const registerUser = useRegisterUserMutation({
    onMutate: () => {
      setIsSubmitting(true);
    },
    onSuccess: () => {
      setIsSubmitting(false);
      setCountdown(3);
      const timer = setInterval(() => {
        setCountdown((prevCountdown) => {
          if (prevCountdown <= 1) {
            clearInterval(timer);
            navigate('/c/new', { replace: true });
            return 0;
          } else {
            return prevCountdown - 1;
          }
        });
      }, 1000);
    },
    onError: (error: unknown) => {
      setIsSubmitting(false);
      if ((error as TError).response?.data?.message) {
        setErrorMessage((error as TError).response?.data?.message ?? '');
      }
    },
  });

  const renderInput = (id: string, label: TranslationKeys, type: string, validation: object) => {
    const fieldLabel = localize(label);
    const field = register(
      id as 'name' | 'email' | 'username' | 'password' | 'confirm_password',
      validation,
    );

    return (
      <div className="mb-4">
        <div className="relative">
          {type === 'password' ? (
            <SecretInput
              id={id}
              autoComplete={id}
              aria-label={fieldLabel}
              {...field}
              aria-invalid={!!errors[id]}
              className={authSecretInputClassName}
              placeholder=" "
              data-testid={id}
              label={fieldLabel}
              labelClassName={authLabelClassName}
              controlsClassName="right-2"
              buttonClassName={authSecretButtonClassName}
            />
          ) : (
            <>
              <Input
                id={id}
                type={type}
                autoComplete={id}
                aria-label={fieldLabel}
                {...field}
                aria-invalid={!!errors[id]}
                className={authInputClassName}
                placeholder=" "
                data-testid={id}
              />
              <label htmlFor={id} className={authLabelClassName}>
                {fieldLabel}
              </label>
            </>
          )}
        </div>
        {errors[id] && (
          <span role="alert" className="mt-1 text-sm text-text-destructive">
            {String(errors[id]?.message) ?? ''}
          </span>
        )}
      </div>
    );
  };

  return (
    <>
      {errorMessage && (
        <ErrorMessage>
          {localize('com_auth_error_create')} {errorMessage}
        </ErrorMessage>
      )}
      {registerUser.isSuccess && countdown > 0 && (
        <div
          className="rounded-md border border-status-success-border bg-status-success-subtle px-3 py-2 text-sm text-text-secondary"
          role="alert"
        >
          {localize(
            startupConfig?.emailEnabled
              ? 'com_auth_registration_success_generic'
              : 'com_auth_registration_success_insecure',
          ) +
            ' ' +
            localize('com_auth_email_verification_redirecting', { 0: countdown.toString() })}
        </div>
      )}
      {!startupConfigError && !isFetching && (
        <>
          <form
            className="mt-6"
            aria-label="Registration form"
            method="POST"
            onSubmit={handleSubmit(({ phoneNational, ...data }: TRegistrationFormValues) => {
              registerUser.mutate({
                ...data,
                phone: `+${dial}${phoneNational.replace(/\D/g, '')}`,
                token: token ?? undefined,
              });
            })}
          >
            {renderInput('name', 'com_auth_full_name', 'text', {
              required: localize('com_auth_name_required'),
              minLength: {
                value: 3,
                message: localize('com_auth_name_min_length'),
              },
              maxLength: {
                value: 80,
                message: localize('com_auth_name_max_length'),
              },
            })}
            {renderInput('username', 'com_auth_username', 'text', {
              required: localize('com_auth_username_required'),
              minLength: {
                value: 2,
                message: localize('com_auth_username_min_length'),
              },
              maxLength: {
                value: 80,
                message: localize('com_auth_username_max_length'),
              },
            })}
            {renderInput('email', 'com_auth_email', 'email', {
              required: localize('com_auth_email_required'),
              minLength: {
                value: 1,
                message: localize('com_auth_email_min_length'),
              },
              maxLength: {
                value: 120,
                message: localize('com_auth_email_max_length'),
              },
              pattern: {
                value: /\S+@\S+\.\S+/,
                message: localize('com_auth_email_pattern'),
              },
            })}
            <div className="mb-4">
              <div className="relative flex gap-2">
                <div className="relative w-2/5">
                  <select
                    id="phoneCountry"
                    aria-label={localize('com_auth_phone_country')}
                    value={country}
                    onChange={(e) => setCountry(e.target.value as CountryCode)}
                    className={`${authInputClassName} appearance-none pr-8`}
                    data-testid="phone-country"
                  >
                    {countryOptions.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.name} (+{option.dial})
                      </option>
                    ))}
                  </select>
                  <label htmlFor="phoneCountry" className={authStaticLabelClassName}>
                    {localize('com_auth_phone_country')}
                  </label>
                </div>
                <div className="relative w-3/5">
                  <Input
                    id="phoneNational"
                    type="tel"
                    autoComplete="tel-national"
                    aria-label={localize('com_auth_phone')}
                    {...register('phoneNational', {
                      required: localize('com_auth_phone_required'),
                      validate: (value: string) =>
                        isValidPhoneNumber(
                          `+${getCountryCallingCode(countryRef.current)}${value.replace(/\D/g, '')}`,
                        ) || localize('com_auth_phone_invalid'),
                    })}
                    aria-invalid={!!errors.phoneNational}
                    className={authInputClassName}
                    placeholder=" "
                    data-testid="phone-national"
                  />
                  <label htmlFor="phoneNational" className={authLabelClassName}>
                    {localize('com_auth_phone')}
                  </label>
                </div>
              </div>
              {errors.phoneNational && (
                <span role="alert" className="mt-1 text-sm text-text-destructive">
                  {String(errors.phoneNational?.message) ?? ''}
                </span>
              )}
            </div>
            {renderInput('password', 'com_auth_password', 'password', {
              required: localize('com_auth_password_required'),
              minLength: {
                value: startupConfig?.minPasswordLength || 8,
                message: localize('com_auth_password_min_length'),
              },
              maxLength: {
                value: 128,
                message: localize('com_auth_password_max_length'),
              },
            })}
            {renderInput('confirm_password', 'com_auth_password_confirm', 'password', {
              validate: (value: string) =>
                value === password || localize('com_auth_password_not_match'),
            })}

            <div className="mt-4 flex items-start gap-2">
              <input
                id="trainingConsent"
                type="checkbox"
                className="mt-1 size-4 accent-accent-primary"
                aria-describedby="trainingConsentHint"
                {...register('trainingConsentAccepted')}
              />
              <label htmlFor="trainingConsent" className="text-xs text-text-secondary">
                {localize('com_auth_training_consent')}{' '}
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent-primary hover:underline"
                >
                  {localize('com_ui_privacy_policy')}
                </a>
              </label>
            </div>

            {startupConfig?.turnstile?.siteKey && (
              <div className="my-4 flex justify-center">
                <Turnstile
                  siteKey={startupConfig.turnstile.siteKey}
                  options={{
                    ...startupConfig.turnstile.options,
                    theme: validTheme,
                  }}
                  onSuccess={(token) => setTurnstileToken(token)}
                  onError={() => setTurnstileToken(null)}
                  onExpire={() => setTurnstileToken(null)}
                />
              </div>
            )}

            <div className="mt-6">
              <Button
                disabled={
                  Object.keys(errors).length > 0 ||
                  isSubmitting ||
                  (requireCaptcha && !turnstileToken)
                }
                type="submit"
                aria-label="Submit registration"
                variant="submit"
                className="h-12 w-full rounded-2xl"
              >
                {isSubmitting ? <Spinner /> : localize('com_auth_continue')}
              </Button>
            </div>
          </form>

          <p className="my-4 text-center text-sm font-light text-text-secondary">
            {localize('com_auth_already_have_account')}{' '}
            <a
              href={loginPage()}
              aria-label="Login"
              className="inline-flex p-1 text-sm font-medium text-accent-primary transition-colors hover:text-accent-primary-hover"
            >
              {localize('com_auth_login')}
            </a>
          </p>
        </>
      )}
    </>
  );
};

export default Registration;
