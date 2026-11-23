import { z } from 'zod';

/**
 * E.164: `+` followed by 7–15 digits with a 1–9 leading digit, e.g. `+919876543210`.
 * The client composes the full number from a country-code selector and the
 * national number; this is the server-side format gate.
 */
export const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/;

export const phoneSchema = z
  .string()
  .max(16)
  .regex(PHONE_PATTERN, 'Invalid phone number. Use +<country code><number>.');

export interface SignupIdentityInput {
  username?: string;
  phone?: string;
}

export interface SignupIdentityDeps {
  /** Looks up an existing user by the given criteria, e.g. `{ username }` or `{ phone }`. */
  findUser: (criteria: Record<string, string>) => Promise<{ _id?: unknown } | null>;
  /** Usernames no new registration may claim, compared case-insensitively. */
  reservedUsernames?: string[];
}

export type SignupIdentityResult = { ok: true } | { ok: false; status: number; message: string };

/**
 * Signup collision checks shared by every registration path: reserved or taken
 * usernames and phone numbers already in use. Email-in-use is deliberately
 * handled separately in `registerUser`, whose ambiguous response guards
 * against email enumeration.
 */
export async function checkSignupIdentity(
  identity: SignupIdentityInput,
  { findUser, reservedUsernames = [] }: SignupIdentityDeps,
): Promise<SignupIdentityResult> {
  const username = identity.username?.trim().toLowerCase();
  if (username) {
    if (reservedUsernames.some((name) => name.trim().toLowerCase() === username)) {
      return {
        ok: false,
        status: 403,
        message: 'This username is reserved. Please choose another one.',
      };
    }

    const byUsername = await findUser({ username });
    if (byUsername) {
      return {
        ok: false,
        status: 409,
        message: 'This username is already taken. Please choose another one.',
      };
    }
  }

  const phone = identity.phone?.trim();
  if (phone) {
    const byPhone = await findUser({ phone });
    if (byPhone) {
      return { ok: false, status: 409, message: 'This phone number is already in use.' };
    }
  }

  return { ok: true };
}
