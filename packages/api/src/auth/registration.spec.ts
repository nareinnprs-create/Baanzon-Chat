import type { TRegistrationConfig } from 'librechat-data-provider';
import { isEmailVerificationRequired, isInviteOnlyRegistration } from './registration';

const registration = (overrides: Partial<TRegistrationConfig> = {}): TRegistrationConfig => ({
  inviteOnly: false,
  requireEmailVerification: true,
  emailVerificationRequiredInProduction: true,
  ...overrides,
});

describe('isEmailVerificationRequired', () => {
  it('returns false when email is not configured, even in production', () => {
    expect(
      isEmailVerificationRequired({
        registration: registration(),
        emailEnabled: false,
        isProduction: true,
      }),
    ).toBe(false);
  });

  it('returns false when email is not configured and verification is explicitly required', () => {
    expect(
      isEmailVerificationRequired({
        registration: registration({ requireEmailVerification: true }),
        emailEnabled: false,
        isProduction: false,
      }),
    ).toBe(false);
  });

  it('forces verification in production even when requireEmailVerification is false', () => {
    expect(
      isEmailVerificationRequired({
        registration: registration({ requireEmailVerification: false }),
        emailEnabled: true,
        isProduction: true,
      }),
    ).toBe(true);
  });

  it('does not force verification in production when emailVerificationRequiredInProduction is false', () => {
    expect(
      isEmailVerificationRequired({
        registration: registration({
          requireEmailVerification: false,
          emailVerificationRequiredInProduction: false,
        }),
        emailEnabled: true,
        isProduction: true,
      }),
    ).toBe(false);
  });

  it('respects requireEmailVerification outside production', () => {
    expect(
      isEmailVerificationRequired({
        registration: registration({ requireEmailVerification: false }),
        emailEnabled: true,
        isProduction: false,
      }),
    ).toBe(false);
    expect(
      isEmailVerificationRequired({
        registration: registration({ requireEmailVerification: true }),
        emailEnabled: true,
        isProduction: false,
      }),
    ).toBe(true);
  });

  it('applies safe defaults when the registration block is omitted', () => {
    expect(isEmailVerificationRequired({ emailEnabled: true, isProduction: false })).toBe(true);
    expect(isEmailVerificationRequired({ emailEnabled: true, isProduction: true })).toBe(true);
  });
});

describe('isInviteOnlyRegistration', () => {
  it('defaults to false when the registration block is omitted', () => {
    expect(isInviteOnlyRegistration({})).toBe(false);
  });

  it('returns false when inviteOnly is not set', () => {
    expect(isInviteOnlyRegistration({ registration: registration() })).toBe(false);
    expect(isInviteOnlyRegistration({ registration: { inviteOnly: false } })).toBe(false);
  });

  it('returns true when inviteOnly is set', () => {
    expect(isInviteOnlyRegistration({ registration: registration({ inviteOnly: true }) })).toBe(
      true,
    );
    expect(isInviteOnlyRegistration({ registration: { inviteOnly: true } })).toBe(true);
  });
});
