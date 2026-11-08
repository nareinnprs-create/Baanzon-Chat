import type { TRegistrationConfig } from 'librechat-data-provider';

export interface EmailVerificationPolicyOptions {
  /** The `registration` block from app config; omitted falls back to safe defaults. */
  registration?: TRegistrationConfig;
  /** Whether outbound email is configured. Without it no user can verify, so verification is not required. */
  emailEnabled: boolean;
  /** Whether the deployment runs with `NODE_ENV=production`. */
  isProduction: boolean;
}

/**
 * Whether a local account must have a verified email before it may authenticate.
 *
 * With no `registration` block the defaults apply: verification is required
 * in production by default; non-production respects `requireEmailVerification`.
 * `requireEmailVerification` applies in every environment; `emailVerificationRequiredInProduction`
 * forces it in production even when `requireEmailVerification` is false.
 *
 * Returns `false` when email is not configured, because a user could never verify.
 */
export function isEmailVerificationRequired({
  registration,
  emailEnabled,
  isProduction,
}: EmailVerificationPolicyOptions): boolean {
  if (!emailEnabled) {
    return false;
  }
  const requireEmailVerification = registration?.requireEmailVerification ?? true;
  const requireInProduction = registration?.emailVerificationRequiredInProduction ?? true;
  return requireEmailVerification || (isProduction && requireInProduction);
}

export interface InvitePolicyOptions {
  registration?: Pick<TRegistrationConfig, 'inviteOnly'> | TRegistrationConfig;
}

/**
 * Whether a registration request must present a valid invite token.
 * Defaults to `false` when the `registration` block is absent.
 */
export function isInviteOnlyRegistration({ registration }: InvitePolicyOptions): boolean {
  return registration?.inviteOnly ?? false;
}
