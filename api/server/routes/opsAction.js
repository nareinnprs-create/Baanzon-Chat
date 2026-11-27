/**
 * Management actions for the OPRAIZ console — the write counterpart to
 * /api/admin/ops-summary.
 *
 * POST /api/admin/ops-action
 *   Authorization: Bearer $OPS_SUMMARY_KEY
 *   X-Ops-Actor: <operator id or email>
 *
 * Every action is declared in ACTIONS with its safety metadata (destructive,
 * confirm source, reason requirement), so an action cannot exist without one.
 * Applied actions write exactly one ops_audit row (before/after, actor, reason,
 * idempotency key); the row is inserted before the mutation, so a failed audit
 * write means nothing is applied.
 *
 * Privacy: before/after carry flags, roles, plans, counts and ids only. No
 * message text, titles, prompts, skill bodies, provider keys, tokens or IPs.
 */
const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { SystemRoles, FEATURE_FLAG_KEYS } = require('librechat-data-provider');
const { logger } = require('@librechat/data-schemas');
const { authorizeOpsRequest } = require('./opsSummary');
const {
  invalidateConfigCaches,
  clearAppConfigCache,
  clearOverrideCache,
} = require('~/server/services/Config/app');

const PLANS = ['free', 'lite', 'pro', 'enterprise'];
const CACHE_SCOPES = ['config', 'overrides', 'all'];
const MAX_CREDITS = 1_000_000;
const MAX_BROADCAST_RECIPIENTS = 5000;
const RATE_PER_MINUTE = 30;
const DESTRUCTIVE_PER_HOUR = 5;

class ActionError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const badRequest = (message) => new ActionError(400, 'bad_request', message);
const notFound = (message) => new ActionError(404, 'not_found', message);

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function objectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value))
    ? new mongoose.Types.ObjectId(String(value))
    : null;
}

function redactParams(params) {
  const safe = { ...params };
  if (typeof safe.message === 'string') {
    safe.message = { length: safe.message.length };
  }
  return safe;
}

/* ------------------------------------------------------------------ */
/* Default capability seams (overridable in tests)                     */
/* ------------------------------------------------------------------ */

let catalogCache = { at: 0, models: null };

async function defaultCatalog() {
  if (catalogCache.models && Date.now() - catalogCache.at < 10 * 60 * 1000) {
    return catalogCache.models;
  }
  const account = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN;
  if (!account || !token) {
    throw new ActionError(503, 'catalog_unavailable', 'Cloudflare credentials are not configured');
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/models/search?per_page=200`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new ActionError(
      503,
      'catalog_unavailable',
      `Cloudflare catalog returned ${response.status}`,
    );
  }
  const payload = await response.json();
  const models = (payload.result ?? []).map((model) => ({
    name: model.name,
    deprecated:
      Array.isArray(model.properties) &&
      model.properties.some(
        (property) =>
          /deprecat/i.test(String(property?.property_id ?? '')) &&
          property?.value != null &&
          String(property.value) !== 'false',
      ),
  }));
  catalogCache = { at: Date.now(), models };
  return models;
}

async function defaultCache(scope) {
  if (scope === 'config') {
    await clearAppConfigCache();
    return;
  }
  if (scope === 'overrides') {
    await clearOverrideCache();
    return;
  }
  await invalidateConfigCaches();
}

/* ------------------------------------------------------------------ */
/* Route factory                                                       */
/* ------------------------------------------------------------------ */

function createOpsActionRouter(overrides = {}) {
  const deps = {
    getDb: () => mongoose.connection.db,
    now: () => new Date(),
    catalog: defaultCatalog,
    cache: defaultCache,
    ...overrides,
  };

  const router = express.Router();

  const rateBuckets = new Map();
  let auditIndexReady = false;

  function db(ctx) {
    return ctx.db;
  }

  function collection(ctx, name) {
    return db(ctx) ? db(ctx).collection(name) : null;
  }

  async function audits(ctx) {
    const coll = collection(ctx, 'ops_audit');
    if (!coll) {
      throw new ActionError(503, 'storage_unavailable', 'mongodb is not connected');
    }
    if (!auditIndexReady) {
      try {
        await coll.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true });
      } catch {
        /* an existing index or a standalone engine; uniqueness is checked in code */
      }
      auditIndexReady = true;
    }
    return coll;
  }

  async function requireUser(ctx, target) {
    const id = objectId(target);
    if (!id) {
      throw notFound('target is not a user id');
    }
    const user = await collection(ctx, 'users').findOne({ _id: id });
    if (!user) {
      throw notFound('user not found');
    }
    return user;
  }

  function allowRate(keyHash, destructive) {
    const now = Date.now();
    const bucket = rateBuckets.get(keyHash) ?? { minute: [], hour: [] };
    bucket.minute = bucket.minute.filter((at) => now - at < 60_000);
    bucket.hour = bucket.hour.filter((at) => now - at < 3_600_000);
    if (bucket.minute.length >= RATE_PER_MINUTE) {
      return false;
    }
    if (destructive && bucket.hour.length >= DESTRUCTIVE_PER_HOUR) {
      return false;
    }
    bucket.minute.push(now);
    if (destructive) {
      bucket.hour.push(now);
    }
    rateBuckets.set(keyHash, bucket);
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* Handlers                                                          */
  /* ---------------------------------------------------------------- */

  async function suspendUser(ctx, { target }) {
    const user = await requireUser(ctx, target);
    const before = { suspended: Boolean(user.suspended) };
    const sessions = await collection(ctx, 'sessions').countDocuments({ user: user._id });
    const tokens = await collection(ctx, 'tokens').countDocuments({ userId: user._id });
    return {
      before,
      after: { suspended: true, sessions: 0, tokens: 0 },
      changed: {
        suspended: true,
        alreadySuspended: before.suspended,
        sessionsRevoked: sessions,
        tokensRevoked: tokens,
      },
      apply: async () => {
        await collection(ctx, 'users').updateOne(
          { _id: user._id },
          { $set: { suspended: true, suspendedAt: ctx.now, suspendedBy: ctx.actor } },
        );
        /** Without this a suspended user keeps refreshing an existing session. */
        await Promise.all([
          collection(ctx, 'sessions').deleteMany({ user: user._id }),
          collection(ctx, 'tokens').deleteMany({ userId: user._id }),
        ]);
      },
    };
  }

  async function reactivateUser(ctx, { target }) {
    const user = await requireUser(ctx, target);
    const before = { suspended: Boolean(user.suspended) };
    return {
      before,
      after: { suspended: false },
      changed: { suspended: false, wasSuspended: before.suspended },
      apply: async () => {
        await collection(ctx, 'users').updateOne(
          { _id: user._id },
          { $set: { suspended: false }, $unset: { suspendedAt: '', suspendedBy: '' } },
        );
      },
    };
  }

  async function setRole(ctx, { target, params }) {
    const user = await requireUser(ctx, target);
    const role = String(params.role ?? '');
    if (!Object.values(SystemRoles).includes(role)) {
      throw badRequest(`role must be one of ${Object.values(SystemRoles).join(', ')}`);
    }
    const before = { role: user.role ?? null };
    return {
      before,
      after: { role },
      changed: { role, previousRole: before.role },
      apply: async () => {
        await collection(ctx, 'users').updateOne({ _id: user._id }, { $set: { role } });
      },
    };
  }

  async function reset2fa(ctx, { target }) {
    const user = await requireUser(ctx, target);
    const before = { twoFactorEnabled: Boolean(user.twoFactorEnabled) };
    return {
      before,
      after: { twoFactorEnabled: false },
      changed: { twoFactorEnabled: false },
      apply: async () => {
        await collection(ctx, 'users').updateOne(
          { _id: user._id },
          {
            $set: { twoFactorEnabled: false },
            $unset: {
              totpSecret: '',
              backupCodes: '',
              pendingTotpSecret: '',
              pendingBackupCodes: '',
            },
          },
        );
      },
    };
  }

  async function revokeSessions(ctx, { target }) {
    const user = await requireUser(ctx, target);
    const sessions = await collection(ctx, 'sessions').countDocuments({ user: user._id });
    const tokens = await collection(ctx, 'tokens').countDocuments({ userId: user._id });
    return {
      before: { sessions, tokens },
      after: { sessions: 0, tokens: 0 },
      changed: { sessionsRevoked: sessions, tokensRevoked: tokens },
      apply: async () => {
        await Promise.all([
          collection(ctx, 'sessions').deleteMany({ user: user._id }),
          collection(ctx, 'tokens').deleteMany({ userId: user._id }),
        ]);
      },
    };
  }

  async function deleteUser(ctx, { target }) {
    const user = await requireUser(ctx, target);
    const before = { id: String(user._id), role: user.role ?? null };
    const counts = {};
    return {
      before,
      after: { deleted: true },
      changed: counts,
      apply: async () => {
        const userId = user._id;
        const targets = [
          ['sessions', { user: userId }],
          ['tokens', { userId }],
          ['balances', { user: userId }],
          ['subscriptions', { userId: String(userId) }],
          ['notifications', { userId }],
          ['conversations', { user: String(userId) }],
          ['messages', { user: String(userId) }],
          ['files', { user: userId }],
          ['keys', { userId: String(userId) }],
        ];
        for (const [name, filter] of targets) {
          try {
            const result = await collection(ctx, name).deleteMany(filter);
            counts[name] = result?.deletedCount ?? 0;
          } catch {
            counts[name] = null;
          }
        }
        await collection(ctx, 'users').deleteOne({ _id: userId });
        counts.user = 1;
      },
    };
  }

  async function setPlan(ctx, { target, params }) {
    const user = await requireUser(ctx, target);
    const plan = String(params.plan ?? '').toLowerCase();
    if (!PLANS.includes(plan)) {
      throw badRequest(`plan must be one of ${PLANS.join(', ')}`);
    }
    const before = { plan: user.subscriptionTier ?? 'free' };
    return {
      before,
      after: { plan },
      changed: { plan, previousPlan: before.plan },
      apply: async () => {
        await collection(ctx, 'users').updateOne(
          { _id: user._id },
          { $set: { subscriptionTier: plan } },
        );
        await collection(ctx, 'subscriptions').updateOne(
          { userId: String(user._id) },
          {
            $set: {
              plan,
              status: 'active',
              updatedAt: ctx.now,
              currentPeriodStart: ctx.now,
            },
            $setOnInsert: { userId: String(user._id), createdAt: ctx.now },
          },
          { upsert: true },
        );
      },
    };
  }

  async function creditBalance(ctx, target) {
    const user = await requireUser(ctx, target);
    const balance = await collection(ctx, 'balances').findOne({ user: user._id });
    return { user, balance, current: Number(balance?.tokenCredits ?? 0) };
  }

  async function grantCredits(ctx, { target, params }) {
    const amount = Number(params.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_CREDITS) {
      throw badRequest(`amount must be > 0 and <= ${MAX_CREDITS}`);
    }
    const { user, balance, current } = await creditBalance(ctx, target);
    const next = current + amount;
    return {
      before: { tokenCredits: current },
      after: { tokenCredits: next },
      changed: { granted: amount, tokenCredits: next },
      apply: async () => {
        if (balance) {
          await collection(ctx, 'balances').updateOne(
            { _id: balance._id },
            { $inc: { tokenCredits: amount } },
          );
        } else {
          await collection(ctx, 'balances').insertOne({
            user: user._id,
            tokenCredits: amount,
            createdAt: ctx.now,
            updatedAt: ctx.now,
          });
        }
      },
    };
  }

  async function adjustCredits(ctx, { target, params }) {
    const amount = Number(params.amount);
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > MAX_CREDITS) {
      throw badRequest(`amount must be non-zero and |amount| <= ${MAX_CREDITS}`);
    }
    const { user, current } = await creditBalance(ctx, target);
    const next = current + amount;
    if (next < 0) {
      throw badRequest('adjustment would make the balance negative');
    }
    return {
      before: { tokenCredits: current },
      after: { tokenCredits: next },
      changed: { adjusted: amount, tokenCredits: next },
      apply: async () => {
        await collection(ctx, 'balances').updateOne(
          { user: user._id },
          {
            $inc: { tokenCredits: amount },
            $setOnInsert: { user: user._id, createdAt: ctx.now, updatedAt: ctx.now },
          },
          { upsert: true },
        );
      },
    };
  }

  async function assignModels(ctx, { params }) {
    const product = String(params.product ?? '');
    if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(product)) {
      throw badRequest('product must be a lowercase slug');
    }
    const layers = Array.isArray(params.layers) ? params.layers.map(String) : [];
    if (layers.length === 0 || layers.length > 8) {
      throw badRequest('layers must contain 1..8 model ids');
    }
    const catalog = await deps.catalog();
    const byName = new Map(catalog.map((model) => [model.name, model]));
    for (const layer of layers) {
      const model = byName.get(layer);
      if (!model) {
        throw badRequest(`model ${layer} is not in the live Cloudflare catalog`);
      }
      if (model.deprecated) {
        throw badRequest(`model ${layer} is deprecated and cannot be assigned`);
      }
    }
    const key = `model-assignment:${product}`;
    const existing = await collection(ctx, 'ops_settings').findOne({ _id: key });
    return {
      before: { product, layers: existing?.layers ?? null },
      after: { product, layers },
      changed: { product, layers, persisted: true, appliesOn: 'next config reload' },
      apply: async () => {
        await collection(ctx, 'ops_settings').updateOne(
          { _id: key },
          { $set: { product, layers, updatedAt: ctx.now, updatedBy: ctx.actor } },
          { upsert: true },
        );
      },
    };
  }

  async function clearCache(ctx, { params }) {
    const scope = String(params.scope ?? '');
    if (!CACHE_SCOPES.includes(scope)) {
      throw badRequest(`scope must be one of ${CACHE_SCOPES.join(', ')}`);
    }
    return {
      before: { scope },
      after: { scope, cleared: true },
      changed: { scope, cleared: true },
      apply: async () => {
        await deps.cache(scope);
      },
    };
  }

  async function broadcast(ctx, { params }) {
    const segment = String(params.segment ?? '');
    const message = String(params.message ?? '').trim();
    const match = /^(role|plan):([A-Za-z0-9_-]{2,40})$/.exec(segment);
    if (!match) {
      throw badRequest('segment must be role:<ROLE> or plan:<PLAN>');
    }
    if (message.length === 0 || message.length > 2000) {
      throw badRequest('message must be 1..2000 characters');
    }
    const [, kind, value] = match;
    let filter;
    if (kind === 'role') {
      filter = { role: value };
    } else if (value === 'free') {
      filter = { $or: [{ subscriptionTier: 'free' }, { subscriptionTier: { $exists: false } }] };
    } else {
      filter = { subscriptionTier: value };
    }
    const recipients = await collection(ctx, 'users')
      .find(filter, { projection: { _id: 1 } })
      .limit(MAX_BROADCAST_RECIPIENTS)
      .toArray();
    return {
      before: { segment, recipients: 0 },
      after: { segment, recipients: recipients.length },
      changed: { segment, recipients: recipients.length },
      apply: async () => {
        if (recipients.length === 0) {
          return;
        }
        await collection(ctx, 'notifications').insertMany(
          recipients.map((user) => ({
            userId: user._id,
            type: 'system',
            title: 'Announcement',
            body: message,
            read: false,
            createdAt: ctx.now,
            updatedAt: ctx.now,
          })),
        );
      },
    };
  }

  async function toggleFlag(ctx, { params }) {
    const flag = String(params.flag ?? '');
    if (!FEATURE_FLAG_KEYS.includes(flag)) {
      throw badRequest(`flag must be one of ${FEATURE_FLAG_KEYS.join(', ')}`);
    }
    if (typeof params.enabled !== 'boolean') {
      throw badRequest('enabled must be a boolean');
    }
    const existing = await collection(ctx, 'flag_overrides').findOne({
      key: flag,
      scope: 'global',
    });
    return {
      before: { enabled: existing?.value ?? null },
      after: { enabled: params.enabled },
      changed: { flag, enabled: params.enabled },
      apply: async () => {
        await collection(ctx, 'flag_overrides').updateOne(
          { key: flag, scope: 'global' },
          {
            $set: {
              key: flag,
              scope: 'global',
              value: params.enabled,
              updatedAt: ctx.now,
              updatedBy: ctx.actor,
            },
          },
          { upsert: true },
        );
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /* Declarative allow-list                                            */
  /* ---------------------------------------------------------------- */

  const ACTIONS = {
    'user.suspend': { handler: suspendUser },
    'user.reactivate': { handler: reactivateUser },
    'user.set_role': { handler: setRole, reasonRequired: true },
    'user.reset_2fa': { handler: reset2fa },
    'user.revoke_sessions': { handler: revokeSessions },
    'user.export': {
      disabled: 'no export worker is deployed; the data package cannot be built',
    },
    'user.delete': {
      handler: deleteUser,
      destructive: true,
      confirmFrom: 'target',
      reasonRequired: true,
    },
    'entitlement.set_plan': { handler: setPlan },
    'credits.grant': { handler: grantCredits, reasonRequired: true },
    'credits.adjust': {
      handler: adjustCredits,
      destructive: true,
      confirmFrom: 'target',
      reasonRequired: true,
    },
    'model.assign': { handler: assignModels },
    'search.reindex': {
      disabled: 'no reindex worker is deployed; Meilisearch is fed by the sync service',
    },
    'cache.clear': { handler: clearCache },
    'announcement.broadcast': {
      handler: broadcast,
      destructive: true,
      confirmFrom: 'segment',
      reasonRequired: true,
    },
    'feature.toggle': { handler: toggleFlag },
  };

  /* ---------------------------------------------------------------- */
  /* Route                                                             */
  /* ---------------------------------------------------------------- */

  router.post('/', async (req, res) => {
    const auth = authorizeOpsRequest(req, { requireActor: true });
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.error });
    }

    const body = req.body ?? {};
    const action = typeof body.action === 'string' ? body.action : '';
    const target = typeof body.target === 'string' ? body.target.trim() : '';
    const params = body.params && typeof body.params === 'object' ? body.params : {};
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const confirm = typeof body.confirm === 'string' ? body.confirm : undefined;
    const dryRun = body.dryRun === true;
    const idempotencyKey =
      typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';

    if (!Object.hasOwn(ACTIONS, action)) {
      return res.status(400).json({ error: 'unknown_action' });
    }
    const definition = ACTIONS[action];
    if (definition.disabled) {
      return res.status(403).json({ error: 'action_disabled', reason: definition.disabled });
    }
    if (target.length === 0 || target.length > 200) {
      return res.status(400).json({ error: 'target is required' });
    }
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      return res.status(400).json({ error: 'idempotencyKey must be 8..200 characters' });
    }
    if (definition.reasonRequired && reason.length < 8) {
      return res.status(400).json({ error: 'reason must be at least 8 characters' });
    }
    if (definition.destructive) {
      const expectedConfirm =
        definition.confirmFrom === 'segment' ? String(params.segment ?? '') : target;
      if (!expectedConfirm || confirm !== expectedConfirm) {
        return res.status(400).json({ error: 'confirm must exactly echo the target or segment' });
      }
    }

    const keyHash = sha256(String(process.env.OPS_SUMMARY_KEY));
    if (!allowRate(keyHash, Boolean(definition.destructive))) {
      return res.status(429).json({ error: 'rate_limited' });
    }

    const ctx = {
      db: deps.getDb(),
      now: deps.now(),
      actor: auth.actor,
      dryRun,
    };
    if (!ctx.db) {
      return res.status(503).json({ error: 'storage_unavailable' });
    }

    const bodyHash = sha256(
      stableStringify({ action, target, params, reason, confirm: confirm ?? null, dryRun }),
    );

    let auditColl;
    try {
      auditColl = await audits(ctx);
    } catch (error) {
      return res.status(error.status ?? 503).json({ error: error.code ?? 'storage_unavailable' });
    }

    const existing = await auditColl.findOne({ idempotencyKey });
    if (existing) {
      if (existing.bodyHash !== bodyHash) {
        return res.status(409).json({ error: 'idempotency_conflict' });
      }
      if (existing.status === 'applied' && existing.result) {
        return res.json(existing.result);
      }
      return res.status(409).json({ error: 'idempotency_in_progress' });
    }

    let plan;
    try {
      plan = await definition.handler(ctx, { target, params });
    } catch (error) {
      const status = error instanceof ActionError ? error.status : 500;
      const code = error instanceof ActionError ? error.code : 'action_failed';
      if (status >= 500) {
        logger.error(`[ops-action] ${action} failed`, error);
      }
      return res.status(status).json({ error: code, message: error.message });
    }

    const appliedAt = ctx.now.toISOString();
    if (dryRun) {
      return res.json({
        ok: true,
        action,
        target,
        changed: plan.changed,
        auditId: null,
        appliedAt,
        dryRun: true,
        before: plan.before,
        after: plan.after,
      });
    }

    let auditId;
    try {
      const inserted = await auditColl.insertOne({
        at: ctx.now,
        actor: auth.actor,
        action,
        target,
        params: redactParams(params),
        before: plan.before ?? null,
        after: plan.after ?? null,
        reason: reason || null,
        idempotencyKey,
        bodyHash,
        status: 'pending',
        result: null,
      });
      auditId = String(inserted.insertedId);
    } catch (error) {
      logger.error('[ops-action] audit write failed; nothing applied', error);
      return res.status(503).json({ error: 'audit_write_failed' });
    }

    try {
      await plan.apply();
    } catch (error) {
      await auditColl
        .deleteOne({ _id: new mongoose.Types.ObjectId(auditId) })
        .catch(() => undefined);
      logger.error(`[ops-action] ${action} apply failed`, error);
      const status = error instanceof ActionError ? error.status : 500;
      return res
        .status(status)
        .json({ error: error instanceof ActionError ? error.code : 'action_failed' });
    }

    const result = { ok: true, action, target, changed: plan.changed, auditId, appliedAt };
    await auditColl
      .updateOne(
        { _id: new mongoose.Types.ObjectId(auditId) },
        { $set: { status: 'applied', result } },
      )
      .catch((error) => logger.error('[ops-action] audit finalize failed', error));

    return res.json(result);
  });

  return router;
}

module.exports = createOpsActionRouter();
module.exports.createOpsActionRouter = createOpsActionRouter;
