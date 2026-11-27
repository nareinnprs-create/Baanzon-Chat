/**
 * Ops summary contract tests: auth, section whitelist, availability shapes,
 * the explicit-only feedback section, privacy invariants and the list cap.
 *
 * The route is exercised against an in-memory collection fake so the test does
 * not need MongoDB; environment-dependent sections are injected.
 */
const express = require('express');
const request = require('supertest');

jest.mock('@librechat/api', () => ({
  getMetricsRegistry: () => null,
}));
jest.mock('~/server/services/Config/loadCustomConfig', () => jest.fn(async () => ({})));

const { createOpsSummaryRouter } = require('../opsSummary');

const KEY = 'ops-summary-test-key-0123456789';
const NOW = new Date('2026-11-27T12:00:00.000Z');

function toTime(value) {
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : NaN;
}

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') {
      return condition.some((entry) => matches(doc, entry));
    }
    const value = doc[key];
    if (condition instanceof RegExp) {
      return condition.test(String(value ?? ''));
    }
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('$gte' in condition && !(toTime(value) >= toTime(condition.$gte))) return false;
      if ('$gt' in condition && !(toTime(value) > toTime(condition.$gt))) return false;
      if ('$lt' in condition && !(toTime(value) < toTime(condition.$lt))) return false;
      if ('$ne' in condition && String(value) === String(condition.$ne)) return false;
      if ('$in' in condition && !condition.$in.map(String).includes(String(value))) return false;
      if ('$regex' in condition) {
        const regex =
          condition.$regex instanceof RegExp
            ? condition.$regex
            : new RegExp(condition.$regex, condition.$options);
        if (!regex.test(String(value ?? ''))) return false;
      }
      return true;
    }
    return String(value) === String(condition);
  });
}

function project(doc, projection) {
  if (!projection) return { ...doc };
  const out = {};
  for (const [key, include] of Object.entries(projection)) {
    if (include && key in doc) out[key] = doc[key];
  }
  if (projection._id !== 0 && '_id' in doc && !('_id' in out)) out._id = doc._id;
  return out;
}

function collection(rows) {
  return {
    find(filter = {}, options = {}) {
      let result = rows.filter((row) => matches(row, filter));
      const cursor = {
        sort(spec) {
          const [[field, direction]] = Object.entries(spec ?? {});
          if (field) {
            result = [...result].sort((a, b) => {
              const left = toTime(a[field]) || 0;
              const right = toTime(b[field]) || 0;
              return direction < 0 ? right - left : left - right;
            });
          }
          return cursor;
        },
        limit(value) {
          result = result.slice(0, value);
          return cursor;
        },
        async toArray() {
          return result.map((row) => project(row, options.projection));
        },
      };
      return cursor;
    },
    async countDocuments(filter = {}) {
      return rows.filter((row) => matches(row, filter)).length;
    },
    async distinct(field, filter = {}) {
      const values = new Set();
      for (const row of rows.filter((entry) => matches(entry, filter))) {
        if (row[field] != null) values.add(row[field]);
      }
      return [...values];
    },
  };
}

function makeDb(seed) {
  const data = new Map(Object.entries(seed));
  return {
    collection(name) {
      return collection(data.get(name) ?? []);
    },
  };
}

function daysBefore(days) {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function seed() {
  const users = [];
  for (let index = 0; index < 250; index += 1) {
    users.push({
      _id: `user-${index}`,
      name: `User ${index}`,
      email: index === 0 ? 'secret-user@example.com' : `user${index}@example.com`,
      role: index % 10 === 0 ? 'ADMIN' : 'USER',
      emailVerified: index % 2 === 0,
      twoFactorEnabled: index % 25 === 0,
      createdAt: daysBefore(index % 90),
    });
  }
  return {
    users,
    messages: [
      {
        _id: 'm1',
        user: 'user-1',
        text: 'SECRET_MESSAGE_TEXT',
        createdAt: daysBefore(1),
        tokenCount: 12,
        isCreatedByUser: true,
      },
      {
        _id: 'm2',
        user: 'user-2',
        text: 'SECRET_MESSAGE_TEXT',
        createdAt: daysBefore(10),
        tokenCount: 30,
        isCreatedByUser: false,
      },
    ],
    conversations: [
      { _id: 'c1', user: 'user-1', title: 'SECRET_CONVERSATION_TITLE', createdAt: daysBefore(1) },
    ],
    keys: [
      { _id: 'k1', userId: 'user-1', value: 'SECRET_API_KEY_VALUE', createdAt: daysBefore(1) },
    ],
    skills: [{ _id: 's1', name: 'skill', body: 'SECRET_SKILL_BODY', createdAt: daysBefore(1) }],
    feedback: [
      {
        _id: 'f1',
        subject: 'SECRET_FEEDBACK_SUBJECT',
        message: 'SECRET_FEEDBACK_MESSAGE',
        rating: '5',
        status: 'open',
        email: 'secret-user@example.com',
        createdAt: daysBefore(2),
      },
    ],
    schedules: [{ _id: 'sc1', user: 'user-1', enabled: true, prompt: 'SECRET_PROMPT_PAYLOAD' }],
    transactions: [
      {
        _id: 't1',
        user: 'user-1',
        model: 'glm-5.3',
        tokenType: 'prompt',
        rawAmount: -100,
        createdAt: daysBefore(1),
      },
      {
        _id: 't2',
        user: 'user-1',
        model: 'glm-5.3',
        tokenType: 'completion',
        rawAmount: -40,
        createdAt: daysBefore(1),
      },
    ],
    subscriptions: [
      { _id: 'sub1', userId: 'user-1', plan: 'pro', status: 'active', createdAt: daysBefore(5) },
    ],
    billingpayments: [
      {
        _id: 'p1',
        externalId: 'ext-1',
        email: 'secret-user@example.com',
        amount: 499,
        currency: 'INR',
        status: 'succeeded',
        plan: 'pro',
        createdAt: daysBefore(2),
      },
    ],
    sessions: [{ _id: 'sess1', user: 'user-1', expiration: new Date(NOW.getTime() + 60_000) }],
    auditlogs: [
      {
        _id: 'a1',
        actor: { name: 'Admin One' },
        action: 'role.update',
        target: { name: 'User 1', type: 'user' },
        createdAt: daysBefore(1),
      },
    ],
    files: [{ _id: 'file1', bytes: 1024, filename: 'x.pdf', createdAt: daysBefore(1) }],
    agents: [{ _id: 'ag1', id: 'agent_1', name: 'Agent', model: 'x' }],
    agentapikeys: [{ _id: 'ak1', userId: 'user-1', keyHash: 'SECRET_KEY_HASH' }],
    workflows: [{ _id: 'w1', enabled: true }],
    scheduleruns: [],
    workflow_runs: [],
  };
}

function makeApp(db, overrides = {}) {
  const app = express();
  app.use(
    '/api/admin/ops-summary',
    createOpsSummaryRouter({
      getDb: () => db,
      now: () => NOW,
      host: async () => ({
        uptimeSeconds: 100,
        load1m: 0.1,
        load5m: 0.2,
        memory: { totalBytes: 1000, freeBytes: 500 },
        swap: { totalBytes: 0, freeBytes: 0 },
        disk: { totalBytes: 2000, freeBytes: 1000, mount: '/workspace' },
        cpuCount: 8,
      }),
      meili: async () => ({ available: true, health: 'ok', documents: 10, indexLagSeconds: 2 }),
      metrics: async () => ({
        httpRequestsTotal: 10,
        http5xxTotal: 0,
        requestDuration: { p50: 0.1, p95: 0.2, p99: 0.3 },
        sseStreamsActive: 1,
        generationJobs: { active: 0, completed: 1, failed: 0, retried: 0 },
        queueDepth: null,
        mongooseQueriesTotal: 5,
        processUptimeSeconds: 100,
        topEndpoints: [{ route: '/api/x', count: 3 }],
      }),
      providers: async () => ({
        configHash: 'abc',
        providers: [
          { provider: 'Opraiz', models: ['glm-5.3'], lastSuccessAt: null, lastErrorAt: null },
        ],
      }),
      uploadsBytes: async () => 2048,
      ...overrides,
    }),
  );
  return app;
}

function withKey() {
  process.env.OPS_SUMMARY_KEY = KEY;
}

function authHeader() {
  return { Authorization: `Bearer ${KEY}` };
}

describe('ops-summary auth', () => {
  afterEach(() => {
    delete process.env.OPS_SUMMARY_KEY;
  });

  it('returns 401 for every request when the key is unset', async () => {
    delete process.env.OPS_SUMMARY_KEY;
    const response = await request(makeApp(makeDb(seed()))).get('/api/admin/ops-summary');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
  });

  it('returns 401 for a short key', async () => {
    process.env.OPS_SUMMARY_KEY = 'short';
    const response = await request(makeApp(makeDb(seed())))
      .get('/api/admin/ops-summary')
      .set('Authorization', 'Bearer short');
    expect(response.status).toBe(401);
  });

  it('returns 401 without a header and for a wrong key', async () => {
    withKey();
    const app = makeApp(makeDb(seed()));
    expect((await request(app).get('/api/admin/ops-summary')).status).toBe(401);
    expect(
      (await request(app).get('/api/admin/ops-summary').set('Authorization', 'Bearer nope')).status,
    ).toBe(401);
  });

  it('does not accept the key as a query parameter', async () => {
    withKey();
    const response = await request(makeApp(makeDb(seed()))).get(
      `/api/admin/ops-summary?key=${encodeURIComponent(KEY)}`,
    );
    expect(response.status).toBe(401);
  });

  it('serves the envelope for a valid header key', async () => {
    withKey();
    const response = await request(makeApp(makeDb(seed())))
      .get('/api/admin/ops-summary?section=convos')
      .set(authHeader());
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, schemaVersion: 1 });
    expect(typeof response.body.generatedAt).toBe('string');
    expect(response.body.sections.convos.asOf).toBe(response.body.generatedAt);
  });
});

describe('ops-summary sections', () => {
  beforeEach(withKey);

  it('returns exactly the whitelisted keys for requested sections', async () => {
    const response = await request(makeApp(makeDb(seed())))
      .get('/api/admin/ops-summary?section=users&section=convos')
      .set(authHeader());

    expect(Object.keys(response.body.sections.users).sort()).toEqual(
      [
        'active24h',
        'active30d',
        'active7d',
        'asOf',
        'byRole',
        'inactive30d',
        'inactive60d',
        'inactive90d',
        'list',
        'new30d',
        'new7d',
        'newToday',
        'total',
        'twoFactorEnabled',
        'verified',
      ].sort(),
    );
    expect(Object.keys(response.body.sections.convos).sort()).toEqual(
      [
        'activeUsers24h',
        'activeUsers7d',
        'asOf',
        'avgMessagesPerConvo',
        'conversations7d',
        'conversationsToday',
        'conversationsTotal',
        'messages7d',
        'messagesToday',
        'messagesTotal',
      ].sort(),
    );
  });

  it('ignores an unknown section', async () => {
    const response = await request(makeApp(makeDb(seed())))
      .get('/api/admin/ops-summary?section=nope')
      .set(authHeader());
    expect(response.status).toBe(200);
    expect(response.body.sections).toEqual({});
  });

  it('excludes feedback from all and includes every other section', async () => {
    const response = await request(makeApp(makeDb(seed())))
      .get('/api/admin/ops-summary?section=all')
      .set(authHeader());

    expect(response.body.sections.feedback).toBeUndefined();
    expect(response.body.sections.users).toBeDefined();
    expect(response.body.sections.health).toBeDefined();
    expect(Object.keys(response.body.sections)).toHaveLength(20);
  });

  it('returns available:false with a reason where there is no data source', async () => {
    delete process.env.GIT_SHA;
    const response = await request(
      makeApp(makeDb(seed()), {
        metrics: async () => ({ available: false, reason: 'no registry' }),
        providers: async () => ({ available: false, reason: 'no config' }),
      }),
    )
      .get(
        '/api/admin/ops-summary?section=versions&section=cost&section=quota&section=email&section=metrics&section=providers',
      )
      .set(authHeader());

    for (const name of ['versions', 'cost', 'quota', 'email', 'metrics', 'providers']) {
      expect(response.body.sections[name]).toMatchObject({ available: false });
      expect(typeof response.body.sections[name].reason).toBe('string');
      expect(response.body.sections[name].reason.length).toBeGreaterThan(0);
    }
  });

  it('caps users.list at 200 even when a larger limit is requested', async () => {
    const app = makeApp(makeDb(seed()));
    const big = await request(app)
      .get('/api/admin/ops-summary?section=users&limit=999')
      .set(authHeader());
    expect(big.body.sections.users.list).toHaveLength(200);

    const small = await request(app)
      .get('/api/admin/ops-summary?section=users&limit=10')
      .set(authHeader());
    expect(small.body.sections.users.list).toHaveLength(10);
  });
});

describe('ops-summary privacy invariants', () => {
  beforeEach(withKey);

  it('never returns message text, titles, keys, skill bodies or prompts', async () => {
    const response = await request(makeApp(makeDb(seed())))
      .get('/api/admin/ops-summary?section=all')
      .set(authHeader());
    const body = JSON.stringify(response.body);

    for (const secret of [
      'SECRET_MESSAGE_TEXT',
      'SECRET_CONVERSATION_TITLE',
      'SECRET_API_KEY_VALUE',
      'SECRET_KEY_HASH',
      'SECRET_SKILL_BODY',
      'SECRET_PROMPT_PAYLOAD',
      'SECRET_FEEDBACK_SUBJECT',
      'SECRET_FEEDBACK_MESSAGE',
    ]) {
      expect(body).not.toContain(secret);
    }
    expect(body).not.toMatch(/"text"\s*:/);
    expect(body).not.toMatch(/"title"\s*:/);
    expect(body).not.toMatch(/"firstMessage"\s*:/);
    expect(body).not.toMatch(/"password"\s*:/);
    expect(body).not.toMatch(/"refreshToken"\s*:/);
    expect(body).not.toMatch(/"backupCodes"\s*:/);
  });

  it('keeps the explicitly allowed identity fields on users.list', async () => {
    const response = await request(makeApp(makeDb(seed())))
      .get('/api/admin/ops-summary?section=users&limit=1')
      .set(authHeader());
    expect(Object.keys(response.body.sections.users.list[0]).sort()).toEqual(
      ['createdAt', 'email', 'emailVerified', 'id', 'name', 'role'].sort(),
    );
  });

  it('returns feedback only when it is requested explicitly', async () => {
    const response = await request(makeApp(makeDb(seed())))
      .get('/api/admin/ops-summary?section=feedback')
      .set(authHeader());
    expect(response.body.sections.feedback.counts.open).toBe(1);
    expect(response.body.sections.feedback.recent).toHaveLength(1);
  });
});
