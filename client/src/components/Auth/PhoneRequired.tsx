import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  CountryCode,
  getCountries,
  getCountryCallingCode,
  isValidPhoneNumber,
} from 'libphonenumber-js';
import { Button, Input } from '@librechat/client';
import { useLocalize } from '~/hooks';

/**
 * Full-screen phone collection for accounts created through Google OAuth
 * (Google shares no phone number). The server enforces the same rule; this
 * gate only renders when the authenticated user still lacks one.
 */
export default function PhoneRequired({
  onDone,
  onSignOut,
}: {
  onDone: () => void;
  onSignOut: () => void;
}) {
  const localize = useLocalize();
  const region = navigator.language.split('-')[1];
  const [country, setCountry] = useState<CountryCode>(
    region && getCountries().includes(region as CountryCode)
      ? (region as CountryCode)
      : ('IN' as CountryCode),
  );
  const [national, setNational] = useState('');
  const [error, setError] = useState('');
  const dial = getCountryCallingCode(country);

  const mutation = useMutation({
    mutationFn: (phone: string) => {
      const endpoint = '/api/user/phone';
      return fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      }).then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body.message || localize('com_auth_phone_invalid'));
        }
        return body;
      });
    },
    onSuccess: () => onDone(),
    onError: (err: Error) => setError(err.message || localize('com_auth_phone_invalid')),
  });

  const submit = () => {
    setError('');
    const phone = `+${dial}${national.replace(/\D/g, '')}`;
    if (!isValidPhoneNumber(phone)) {
      setError(localize('com_auth_phone_invalid'));
      return;
    }
    mutation.mutate(phone);
  };

  const inputClassName =
    'webkit-dark-styles transition-color peer h-auto w-full rounded-2xl border border-border-light bg-surface-primary px-3.5 pb-2.5 pt-3 text-text-primary duration-200 hover:border-border-light focus:border-accent-primary focus:outline-none';

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-primary px-4">
      <div className="w-full max-w-md rounded-2xl border border-border-light p-8">
        <h1 className="text-2xl font-semibold text-text-primary">
          {localize('com_auth_phone_required_title')}
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          {localize('com_auth_phone_required_hint')}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-text-destructive">
            {error}
          </p>
        )}
        <div className="mt-5">
          <div className="mb-4 flex gap-2">
            <div className="relative w-2/5">
              <select
                id="phoneCountry"
                aria-label={localize('com_auth_phone_country')}
                value={country}
                onChange={(e) => setCountry(e.target.value as CountryCode)}
                className={`${inputClassName} appearance-none pr-8`}
              >
                {getCountries().map((code) => (
                  <option key={code} value={code}>
                    {new Intl.DisplayNames([navigator.language], { type: 'region' }).of(code)} (+
                    {getCountryCallingCode(code)})
                  </option>
                ))}
              </select>
            </div>
            <Input
              id="phoneNational"
              type="tel"
              autoComplete="tel-national"
              aria-label={localize('com_auth_phone')}
              value={national}
              onChange={(e) => setNational(e.target.value)}
              className="w-3/5"
              placeholder=" "
            />
          </div>
          <Button
            onClick={submit}
            disabled={mutation.isPending || national.replace(/\D/g, '').length < 6}
            variant="submit"
            className="h-12 w-full rounded-2xl"
          >
            {mutation.isPending ? '…' : localize('com_auth_continue')}
          </Button>
          <Button
            variant="ghost"
            onClick={onSignOut}
            className="mt-3 w-full text-text-secondary"
            aria-label="Sign out"
          >
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
