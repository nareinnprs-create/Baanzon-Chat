/**
 * Ops action contract tests: auth + actor, allow-list, confirm/reason gates,
 * dryRun, idempotency, catalog validation and the audit trail.
 */
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');

jest.mock('@librechat/api', () => ({
  getMetricsRegistry: () => null,
}));
jest.mock('~/server/services/Config/loadCustomConfig', () => jest.fn(async () => ({})));
jest.mock('~/server/services/Config/app', () => ({
  invalidateConfigCaches: jest.fn(async () => undefined),
  clearAppConfigCache: jest.fn(async () => undefined),
  clearOverrideCache: jest.fn(async () => undefined),
}));

const { createOpsActionRouter } = require('../opsAction');

const KEY = 'ops-action-test-key-0123456789';
const ACTOR = 'ops@opraiz.com';
const NOW = new Date('2026-11-27T12:00:00.000Z');
const USER_ID = new mongoose.Types.ObjectId().toString();

function same(a, b) {
  return String(a) === String(b);
}

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') {
      return value.some((entry) => matches(doc, entry));
    }
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('$exists' in value) {
        return value.$exists ? doc[key] != null : doc[key] == null;
      }
      return true;
    }
    return same(doc[key], value);
  });
}

function applyUpdate(doc, update) {
  for (const [key, value] of Object.entries(update.$set ?? {})) {
    doc[key] = value;
  }
  for (const key of Object.keys(update.$unset ?? {})) {
    delete doc[key];
  }
  for (const [key, value] of Object.entries(update.$inc ?? {})) {
    doc[key] = (Number(doc[key]) || 0) + value;
  }
}

function makeCollection(rows) {
  return {
    async findOne(filter = {}) {
      return rows.find((row) => matches(row, filter)) ?? null;
    },
    find(filter = {}) {
      let result = rows.filter((row) => matches(row, filter));
      const cursor = {
        limit(value) {
          result = result.slice(0, value);
          return cursor;
        },
        async toArray() {
          return result.map((row) => ({ ...row }));
        },
      };
      return cursor;
    },
    async countDocuments(filter = {}) {
      return rows.filter((row) => matches(row, filter)).length;
    },
    async updateOne(filter, update, options = {}) {
      let doc = rows.find((row) => matches(row, filter));
      if (!doc && options.upsert) {
        doc = { ...filter, ...(update.$setOnInsert ?? {}) };
        applyUpdate(doc, update);
        rows.push(doc);
        return { matchedCount: 0, modifiedCount: 1, upsertedCount: 1 };
      }
      if (!doc) {
        return { matchedCount: 0, modifiedCount: 0 };
      }
      applyUpdate(doc, update);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async insertOne(doc) {
      const id = doc._id ?? new mongoose.Types.ObjectId();
      if (rows.some((row) => same(row._id, id))) {
        const error = new Error('duplicate key');
        error.code = 11000;
        throw error;
      }
      const row = { ...doc, _id: id };
      rows.push(row);
      return { insertedId: id };
    },
    async insertMany(docs) {
      for (const doc of docs) {
        rows.push({ _id: new mongoose.Types.ObjectId(), ...doc });
      }
      return { insertedCount: docs.length };
    },
    async deleteOne(filter = {}) {
      const index = rows.findIndex((row) => matches(row, filter));
      if (index === -1) return { deletedCount: 0 };
      rows.splice(index, 1);
      return { deletedCount: 1 };
    },
    async deleteMany(filter = {}) {
      const before = rows.length;
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (matches(rows[index], filter)) rows.splice(index, 1);
      }
      return { deletedCount: before - rows.length };
    },
    async createIndex() {
      return 'ok';
    },
  };
}

function makeDb(seed = {}) {
  const data = new Map();
  const names = [
    'users',
    'sessions',
    'tokens',
    'balances',
    'subscriptions',
    'notifications',
    'conversations',
    'messages',
    'files',
    'keys',
    'ops_settings',
    'flag_overrides',
    'ops_audit',
  ];
  for (const name of names) {
    data.set(name, [...(seed[name] ?? [])]);
  }
  return {
    data,
    collection(name) {
      if (!data.has(name)) data.set(name, []);
      return makeCollection(data.get(name));
    },
  };
}

function seed() {
  return {
    users: [
      {
        _id: new mongoose.Types.ObjectId(USER_ID),
        name: 'Target',
        email: 'target@example.com',
        role: 'USER',
        emailVerified: true,
        twoFactorEnabled: true,
        suspended: false,
        subscriptionTier: 'free',
        createdAt: NOW,
      },
    ],
    sessions: [{ _id: 's1', user: new mongoose.Types.ObjectId(USER_ID) }],
    tokens: [{ _id: 't1', userId: new mongoose.Types.ObjectId(USER_ID) }],
    balances: [{ _id: 'b1', user: new mongoose.Types.ObjectId(USER_ID), tokenCredits: 100 }],
    subscriptions: [],
  };
}

const CATALOG = [
  { name: 'good-model', deprecated: false },
  { name: 'old-model', deprecated: true },
];

function makeApp(db, overrides = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/admin/ops-action',
    createOpsActionRouter({
      getDb: () => db,
      now: () => NOW,
      catalog: async () => CATALOG,
      cache: async () => undefined,
      ...overrides,
    }),
  );
  return app;
}

function call(app, body, headers = {}) {
  return request(app)
    .post('/api/admin/ops-action')
    .set('Authorization', `Bearer ${KEY}`)
    .set('X-Ops-Actor', ACTOR)
    .set(headers)
    .send(body);
}

let key = 0;
function idem() {
  key += 1;
  return `idem-key-${key}-0123456789`;
}

describe('ops-action auth', () => {
  afterEach(() => {
    delete process.env.OPS_SUMMARY_KEY;
  });

  it('fails closed without a key', async () => {
    delete process.env.OPS_SUMMARY_KEY;
    const response = await request(makeApp(makeDb(seed())))
      .post('/api/admin/ops-action')
      .set('X-Ops-Actor', ACTOR)
      .send({ action: 'user.suspend', target: USER_ID, idempotencyKey: idem() });
    expect(response.status).toBe(401);
  });

  it('rejects a wrong key and a missing actor', async () => {
    process.env.OPS_SUMMARY_KEY = KEY;
    const app = makeApp(makeDb(seed()));
    const wrong = await request(app)
      .post('/api/admin/ops-action')
      .set('Authorization', 'Bearer wrong-key-000000000000')
      .set('X-Ops-Actor', ACTOR)
      .send({ action: 'user.suspend', target: USER_ID, idempotencyKey: idem() });
    expect(wrong.status).toBe(401);

    const noActor = await request(app)
      .post('/api/admin/ops-action')
      .set('Authorization', `Bearer ${KEY}`)
      .send({ action: 'user.suspend', target: USER_ID, idempotencyKey: idem() });
    expect(noActor.status).toBe(400);
  });
});

describe('ops-action allow-list and safety gates', () => {
  beforeEach(() => {
    process.env.OPS_SUMMARY_KEY = KEY;
  });

  it('rejects unknown and disabled actions', async () => {
    const app = makeApp(makeDb(seed()));
    expect(
      (await call(app, { action: 'nope', target: USER_ID, idempotencyKey: idem() })).status,
    ).toBe(400);
    expect(
      (await call(app, { action: 'user.export', target: USER_ID, idempotencyKey: idem() })).status,
    ).toBe(403);
    expect(
      (await call(app, { action: 'search.reindex', target: 'search', idempotencyKey: idem() }))
        .status,
    ).toBe(403);
  });

  it('requires reason for role changes', async () => {
    const app = makeApp(makeDb(seed()));
    const response = await call(app, {
      action: 'user.set_role',
      target: USER_ID,
      params: { role: 'ADMIN' },
      idempotencyKey: idem(),
    });
    expect(response.status).toBe(400);
  });

  it('requires an exact confirm for destructive actions and changes nothing', async () => {
    const db = makeDb(seed());
    const app = makeApp(db);
    const missing = await call(app, {
      action: 'user.delete',
      target: USER_ID,
      reason: 'gdpr request',
      idempotencyKey: idem(),
    });
    expect(missing.status).toBe(400);
    const wrong = await call(app, {
      action: 'user.delete',
      target: USER_ID,
      confirm: 'someone-else',
      reason: 'gdpr request',
      idempotencyKey: idem(),
    });
    expect(wrong.status).toBe(400);
    expect(db.data.get('users')).toHaveLength(1);
    expect(db.data.get('ops_audit')).toHaveLength(0);
  });
});

describe('ops-action dryRun and idempotency', () => {
  beforeEach(() => {
    process.env.OPS_SUMMARY_KEY = KEY;
  });

  it('dryRun returns the projection and leaves state byte-identical', async () => {
    const db = makeDb(seed());
    const app = makeApp(db);
    const before = JSON.stringify(db.data.get('users'));
    const response = await call(app, {
      action: 'user.set_role',
      target: USER_ID,
      params: { role: 'ADMIN' },
      reason: 'promotion approved',
      idempotencyKey: idem(),
      dryRun: true,
    });
    expect(response.status).toBe(200);
    expect(response.body.changed).toEqual({ role: 'ADMIN', previousRole: 'USER' });
    expect(response.body.auditId).toBeNull();
    expect(JSON.stringify(db.data.get('users'))).toBe(before);
    expect(db.data.get('ops_audit')).toHaveLength(0);
  });

  it('applies once per idempotency key and rejects a different body', async () => {
    const db = makeDb(seed());
    const app = makeApp(db);
    const keyValue = idem();
    const body = {
      action: 'credits.grant',
      target: USER_ID,
      params: { amount: 50, note: 'support credit' },
      reason: 'support goodwill',
      idempotencyKey: keyValue,
    };
    const first = await call(app, body);
    expect(first.status).toBe(200);
    const second = await call(app, body);
    expect(second.status).toBe(200);
    expect(second.body.auditId).toBe(first.body.auditId);
    expect(db.data.get('balances')[0].tokenCredits).toBe(150);
    expect(db.data.get('ops_audit')).toHaveLength(1);

    const conflict = await call(app, { ...body, params: { amount: 500, note: 'x' } });
    expect(conflict.status).toBe(409);
    expect(db.data.get('balances')[0].tokenCredits).toBe(150);
  });

  it('writes exactly one audit row with actor, before and after', async () => {
    const db = makeDb(seed());
    const app = makeApp(db);
    const response = await call(app, {
      action: 'credits.grant',
      target: USER_ID,
      params: { amount: 25, note: 'test' },
      reason: 'testing audit',
      idempotencyKey: idem(),
    });
    expect(response.status).toBe(200);
    const audit = db.data.get('ops_audit');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: ACTOR,
      action: 'credits.grant',
      target: USER_ID,
      before: { tokenCredits: 100 },
      after: { tokenCredits: 125 },
      reason: 'testing audit',
      status: 'applied',
    });
    expect(audit[0].idempotencyKey).toMatch(/^idem-key-/);
  });
});

describe('ops-action model catalog validation', () => {
  beforeEach(() => {
    process.env.OPS_SUMMARY_KEY = KEY;
  });

  it('rejects an absent model and a deprecated one', async () => {
    const app = makeApp(makeDb(seed()));
    const absent = await call(app, {
      action: 'model.assign',
      target: 'baanzon-intelligence',
      params: { product: 'baanzon-intelligence', layers: ['missing-model'] },
      idempotencyKey: idem(),
    });
    expect(absent.status).toBe(400);
    expect(absent.body.message).toContain('not in the live Cloudflare catalog');

    const deprecated = await call(app, {
      action: 'model.assign',
      target: 'baanzon-intelligence',
      params: { product: 'baanzon-intelligence', layers: ['old-model'] },
      idempotencyKey: idem(),
    });
    expect(deprecated.status).toBe(400);
    expect(deprecated.body.message).toContain('deprecated');
  });

  it('accepts a live model and persists the assignment', async () => {
    const db = makeDb(seed());
    const app = makeApp(db);
    const response = await call(app, {
      action: 'model.assign',
      target: 'baanzon-intelligence',
      params: { product: 'baanzon-intelligence', layers: ['good-model'] },
      idempotencyKey: idem(),
    });
    expect(response.status).toBe(200);
    expect(response.body.changed).toMatchObject({
      product: 'baanzon-intelligence',
      layers: ['good-model'],
    });
    expect(db.data.get('ops_settings')).toHaveLength(1);
  });
});
