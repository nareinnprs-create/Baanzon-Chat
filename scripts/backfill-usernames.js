/**
 * Backfills `username` for users created before usernames became required at
 * signup. Runs on the pod where the database is reachable (mongosh is absent;
 * this uses the same mongoose stack as the app).
 *
 * Usage: MONGO_URI=... node scripts/backfill-usernames.js [--dry-run]
 *
 * Derived from the email local-part, lowercased and reduced to [a-z0-9._-],
 * with a -2/-3 suffix on collision.
 *
 * shortcut: auth user-doc cache (5s TTL) is not cleared from this out-of-process
 * script; it sleeps 6s after the last write instead. Upgrade to calling
 * invalidateCachedAuthUserDoc if the TTL ever grows.
 */
const path = require('path');
const mongoose = require('mongoose');
const { User } = require('@librechat/data-schemas').createModels(mongoose);

const dryRun = process.argv.includes('--dry-run');
const uri = process.env.MONGO_URI || process.argv.find((arg) => arg.startsWith('mongodb'));

if (!uri) {
  console.error('MONGO_URI is required');
  process.exit(1);
}

const USERNAME_PATTERN = /^[a-z0-9._-]{2,80}$/;

function candidateFromEmail(email) {
  const local = String(email).split('@')[0].toLowerCase();
  let candidate = local
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  if (candidate.length > 80) {
    candidate = candidate.slice(0, 80);
  }
  if (candidate.length < 2) {
    candidate = 'user' + (candidate || '');
  }
  return candidate;
}

(async () => {
  await mongoose.connect(uri);

  const users = await User.find({
    $or: [{ username: { $exists: false } }, { username: '' }, { username: null }],
  })
    .select('email username')
    .lean();

  console.log(`Found ${users.length} users without a username`);

  const taken = new Set(
    (await User.find({}, 'username').lean()).map((u) => u.username).filter(Boolean),
  );

  let updated = 0;
  for (const user of users) {
    let candidate = candidateFromEmail(user.email);
    let suffix = 2;
    while (taken.has(candidate)) {
      const stem = candidate.replace(/-\d+$/, '');
      candidate = `${stem}-${suffix++}`.slice(0, 80);
    }
    if (!USERNAME_PATTERN.test(candidate)) {
      console.warn(`Skipping ${user.email}: candidate "${candidate}" failed the pattern check`);
      continue;
    }

    console.log(`${user.email} -> ${candidate}`);
    taken.add(candidate);
    if (!dryRun) {
      await User.updateOne({ _id: user._id }, { username: candidate });
      updated++;
    }
  }

  console.log(
    `${dryRun ? '[dry-run] would update' : 'Updated'} ${dryRun ? users.length : updated} users`,
  );
  if (!dryRun && updated > 0) {
    await new Promise((resolve) => setTimeout(resolve, 6000));
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
