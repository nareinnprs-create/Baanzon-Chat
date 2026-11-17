import { phoneSchema, checkSignupIdentity } from './signup';

const findUser = jest.fn();

describe('phoneSchema', () => {
  it('accepts E.164 numbers with a 1-9 leading digit', () => {
    expect(phoneSchema.safeParse('+919876543210').success).toBe(true);
    expect(phoneSchema.safeParse('+12065551234').success).toBe(true);
  });

  it('rejects numbers missing the plus, a leading zero, or too short', () => {
    expect(phoneSchema.safeParse('919876543210').success).toBe(false);
    expect(phoneSchema.safeParse('+0919876543210').success).toBe(false);
    expect(phoneSchema.safeParse('+911234').success).toBe(false);
    expect(phoneSchema.safeParse('').success).toBe(false);
  });
});

describe('checkSignupIdentity', () => {
  beforeEach(() => {
    findUser.mockReset().mockResolvedValue(null);
  });

  it('passes for a fresh username and phone without querying when both absent', async () => {
    const result = await checkSignupIdentity({}, { findUser });

    expect(result).toEqual({ ok: true });
    expect(findUser).not.toHaveBeenCalled();
  });

  it('rejects a reserved username case-insensitively with 403', async () => {
    const result = await checkSignupIdentity(
      { username: 'Admin' },
      { findUser, reservedUsernames: ['admin', 'root'] },
    );

    expect(result).toEqual({
      ok: false,
      status: 403,
      message: 'This username is reserved. Please choose another one.',
    });
    expect(findUser).not.toHaveBeenCalled();
  });

  it('rejects a taken username with 409', async () => {
    findUser.mockImplementation(async (criteria: Record<string, string>) =>
      criteria.username === 'takenuser' ? { _id: 'u1' } : null,
    );

    const result = await checkSignupIdentity({ username: 'TakenUser' }, { findUser });

    expect(result).toEqual({
      ok: false,
      status: 409,
      message: 'This username is already taken. Please choose another one.',
    });
  });

  it('rejects a phone already in use with 409', async () => {
    findUser.mockImplementation(async (criteria: Record<string, string>) =>
      criteria.phone === '+919876543210' ? { _id: 'u2' } : null,
    );

    const result = await checkSignupIdentity(
      { username: 'newuser', phone: '+919876543210' },
      { findUser },
    );

    expect(result).toEqual({ ok: false, status: 409, message: 'This phone number is already in use.' });
  });

  it('looks up username and phone for a fully fresh signup', async () => {
    const result = await checkSignupIdentity(
      { username: 'newuser', phone: '+12065551234' },
      { findUser, reservedUsernames: [] },
    );

    expect(result).toEqual({ ok: true });
    expect(findUser).toHaveBeenCalledWith({ username: 'newuser' });
    expect(findUser).toHaveBeenCalledWith({ phone: '+12065551234' });
  });
});
