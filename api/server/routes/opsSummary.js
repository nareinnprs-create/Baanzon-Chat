/**
 * Machine-readable ops summary for the OPRAIZ management console.
 *
 * GET /api/admin/ops-summary
 *   Authorization: Bearer $OPS_SUMMARY_KEY   (header only)
 *   ?section=<name> (repeatable) | ?section=all
 *
 * Read-only, aggregate-only. Every section carries its own `asOf`; a section
 * with no data source in this codebase returns `{ available: false, reason }`
 * instead of a fabricated zero or an empty list pretending to be data.
 *
 * Privacy invariants (enforced by opsSummary.test.js): no message text, no
 * conversation titles, no firstMessage, no prompt/schedule payloads, no skill
 * file contents, no provider keys (not even masked), no RUM traces, no TOTP or
 * backup secrets, no end-user IPs. Numbers, statuses, dates and the explicitly
 * whitelisted identity fields only.
 */
const express = require('express');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const mongoose = require('mongoose');
const { MeiliSearch } = require('meilisearch');
const { logger } = require('@librechat/data-schemas');
const { getMetricsRegistry } = require('@librechat/api');
const loadCustomConfig = require('~/server/services/Config/loadCustomConfig');

const SCHEMA_VERSION = 1;
const MIN_KEY_LENGTH = 16;
const MAX_LIST = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Sections returned by `?section=all`; feedback is explicit-only (T2). */
const ALL_SECTIONS = [
  'health',
  'host',
  'versions',
  'users',
  'engagement',
  'convos',
  'usage',
  'cost',
  'tiers',
  'payments',
  'quota',
  'auth',
  'security',
  'email',
  'metrics',
  'files',
  'agents',
  'schedules',
  'search',
  'providers',
];

const UNAVAILABLE = (reason) => ({ available: false, reason });

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function round(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : value;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? round(numerator / denominator) : null;
}

/** Week start (Monday, UTC) for a date. */
function weekStart(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d;
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

/** Swap from /proc/meminfo; nulls when the platform does not expose it. */
function readSwap() {
  try {
    const info = fs.readFileSync('/proc/meminfo', 'utf8');
    const total = /SwapTotal:\s+(\d+) kB/.exec(info);
    const free = /SwapFree:\s+(\d+) kB/.exec(info);
    if (!total || !free) {
      return { totalBytes: null, freeBytes: null };
    }
    return { totalBytes: Number(total[1]) * 1024, freeBytes: Number(free[1]) * 1024 };
  } catch {
    return { totalBytes: null, freeBytes: null };
  }
}

async function defaultHost() {
  const load = os.loadavg();
  let disk = { totalBytes: null, freeBytes: null, mount: process.cwd() };
  try {
    if (typeof fs.promises.statfs === 'function') {
      const stats = await fs.promises.statfs(process.cwd());
      disk = {
        totalBytes: Number(stats.bsize) * Number(stats.blocks),
        freeBytes: Number(stats.bsize) * Number(stats.bavail),
        mount: process.cwd(),
      };
    }
  } catch {
    /* keep nulls */
  }
  return {
    uptimeSeconds: Math.round(os.uptime()),
    load1m: round(load[0]),
    load5m: round(load[1]),
    memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
    swap: readSwap(),
    disk,
    cpuCount: os.cpus().length,
  };
}

async function pingMongo() {
  try {
    const db = mongoose.connection.db;
    if (!db) {
      return 'down';
    }
    await db.admin().ping();
    return 'ok';
  } catch {
    return 'down';
  }
}

function meiliClient() {
  if (!process.env.MEILI_HOST) {
    return null;
  }
  return new MeiliSearch({ host: process.env.MEILI_HOST, apiKey: process.env.MEILI_MASTER_KEY });
}

async function defaultMeili() {
  const client = meiliClient();
  if (!client) {
    return { available: false, reason: 'MEILI_HOST is not configured' };
  }
  try {
    const { status } = await client.health();
    if (status !== 'available') {
      return { available: true, health: 'down', documents: null, indexLagSeconds: null };
    }
    let documents = null;
    let indexLagSeconds = null;
    try {
      const stats = await client.getStats();
      documents = Number.isFinite(stats?.numberOfDocuments) ? stats.numberOfDocuments : null;
      if (stats?.lastUpdate) {
        const at = Date.parse(stats.lastUpdate);
        if (Number.isFinite(at)) {
          indexLagSeconds = Math.max(0, Math.round((Date.now() - at) / 1000));
        }
      }
    } catch {
      /* health is still useful without stats */
    }
    return { available: true, health: 'ok', documents, indexLagSeconds };
  } catch {
    return { available: true, health: 'down', documents: null, indexLagSeconds: null };
  }
}

function endpointModels(entry) {
  if (Array.isArray(entry.models?.default)) {
    return entry.models.default;
  }
  return Array.isArray(entry.models) ? entry.models : [];
}

function meiliStatus(meili) {
  if (meili?.available === false || meili?.health === 'down') {
    return 'down';
  }
  return 'ok';
}

/** Only names and models are hashed; credentials never enter the digest. */
async function defaultProviderSnapshot() {
  let config;
  try {
    config = await loadCustomConfig();
  } catch {
    return UNAVAILABLE('custom config could not be loaded');
  }
  const endpoints = config?.endpoints;
  if (!endpoints) {
    return UNAVAILABLE('no custom endpoints are configured');
  }
  const entries = Array.isArray(endpoints)
    ? endpoints
    : Object.entries(endpoints).map(([name, value]) => ({ name, ...(value || {}) }));
  const sanitized = entries.map((entry) => ({
    provider: entry.name ?? entry.provider ?? 'custom',
    models: endpointModels(entry),
  }));
  if (sanitized.length === 0) {
    return UNAVAILABLE('no custom endpoints are configured');
  }
  return {
    configHash: sha256(JSON.stringify(sanitized)),
    providers: sanitized.map((entry) => ({
      provider: entry.provider,
      models: entry.models.slice(0, 50),
      lastSuccessAt: null,
      lastErrorAt: null,
    })),
  };
}

/** Directory size with a hard entry cap so a huge tree cannot stall the pull. */
async function directoryBytes(root, maxEntries = 20000) {
  let entries = 0;
  let total = 0;
  async function walk(dir) {
    let items;
    try {
      items = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      if (entries++ > maxEntries) {
        return;
      }
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        await walk(full);
      } else if (item.isFile()) {
        try {
          total += (await fs.promises.stat(full)).size;
        } catch {
          /* raced with a delete */
        }
      }
    }
  }
  await walk(root);
  return entries > maxEntries ? null : total;
}

function histogramQuantiles(values, quantiles) {
  const buckets = values
    .filter((value) => value.metricName?.endsWith('_bucket'))
    .map((value) => ({ le: Number(value.labels.le), count: Number(value.value) }))
    .filter((bucket) => Number.isFinite(bucket.le) && Number.isFinite(bucket.count))
    .sort((a, b) => a.le - b.le);
  if (buckets.length === 0) {
    return Object.fromEntries(quantiles.map((q) => [q, null]));
  }
  const total = buckets[buckets.length - 1].count;
  const result = {};
  for (const q of quantiles) {
    const target = total * q;
    let previous = { le: 0, count: 0 };
    let hit = null;
    for (const bucket of buckets) {
      if (bucket.count >= target) {
        hit = bucket;
        break;
      }
      previous = bucket;
    }
    if (!hit || !Number.isFinite(hit.le)) {
      result[q] = null;
      continue;
    }
    const span = hit.count - previous.count;
    const fraction = span > 0 ? (target - previous.count) / span : 0;
    result[q] = round(previous.le + (hit.le - previous.le) * fraction);
  }
  return result;
}

function sumMetric(values, predicate = () => true) {
  return values
    .filter((value) => !value.metricName || !value.metricName.endsWith('_bucket'))
    .filter(predicate)
    .reduce((total, value) => total + (Number(value.value) || 0), 0);
}

async function defaultMetricsSnapshot() {
  const registry = getMetricsRegistry();
  if (!registry) {
    return UNAVAILABLE('the in-process prom-client registry is not initialised');
  }
  try {
    const metrics = await registry.getMetricsAsJSON();
    const byName = new Map(metrics.map((metric) => [metric.name, metric.values ?? []]));
    const http = byName.get('http_requests_total') ?? [];
    const duration = byName.get('http_request_duration_seconds') ?? [];
    const jobs = byName.get('generation_jobs_total') ?? [];
    const jobsInFlight = byName.get('generation_jobs_in_flight') ?? [];
    const sseInFlight = byName.get('sse_streams_in_flight') ?? [];
    const mongooseQueries = byName.get('mongoose_queries_total') ?? [];

    const endpointCounts = new Map();
    for (const value of http) {
      const route = value.labels?.path ?? 'unknown';
      endpointCounts.set(route, (endpointCounts.get(route) ?? 0) + (Number(value.value) || 0));
    }
    const topEndpoints = [...endpointCounts.entries()]
      .map(([route, count]) => ({ route, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const quantiles = histogramQuantiles(duration, [0.5, 0.95, 0.99]);
    const jobResults = new Map();
    for (const value of jobs) {
      const result = value.labels?.result ?? 'unknown';
      jobResults.set(result, (jobResults.get(result) ?? 0) + (Number(value.value) || 0));
    }

    return {
      httpRequestsTotal: sumMetric(http),
      http5xxTotal: sumMetric(http, (value) => String(value.labels?.status ?? '').startsWith('5')),
      requestDuration: { p50: quantiles[0.5], p95: quantiles[0.95], p99: quantiles[0.99] },
      sseStreamsActive: sumMetric(sseInFlight),
      generationJobs: {
        active: sumMetric(jobsInFlight),
        completed: jobResults.get('completed') ?? 0,
        failed: jobResults.get('failed') ?? 0,
        retried: jobResults.get('retried') ?? 0,
      },
      queueDepth: null,
      mongooseQueriesTotal: sumMetric(mongooseQueries),
      processUptimeSeconds: Math.round(process.uptime()),
      topEndpoints,
    };
  } catch (error) {
    logger.warn('[ops-summary] metrics snapshot failed', error);
    return UNAVAILABLE('the prom-client registry could not be read');
  }
}

/* ------------------------------------------------------------------ */
/* Route factory                                                       */
/* ------------------------------------------------------------------ */

function createOpsSummaryRouter(overrides = {}) {
  const deps = {
    getDb: () => mongoose.connection.db,
    now: () => new Date(),
    host: defaultHost,
    meili: defaultMeili,
    metrics: defaultMetricsSnapshot,
    providers: defaultProviderSnapshot,
    uploadsBytes: () => directoryBytes(path.join(process.cwd(), 'uploads')),
    ...overrides,
  };

  const router = express.Router();

  function authorized(req) {
    const expected = process.env.OPS_SUMMARY_KEY;
    if (!expected || expected.length < MIN_KEY_LENGTH) {
      return false;
    }
    const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') ?? '');
    if (!match) {
      return false;
    }
    const provided = match[1].trim();
    if (provided.length !== expected.length) {
      return false;
    }
    try {
      return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  function context(req) {
    const db = deps.getDb();
    return { db, now: deps.now(), query: req.query ?? {}, deps };
  }

  function collection(ctx, name) {
    return ctx.db ? ctx.db.collection(name) : null;
  }

  async function countDocs(ctx, name, filter = {}) {
    const coll = collection(ctx, name);
    return coll ? coll.countDocuments(filter) : null;
  }

  async function findDocs(ctx, name, filter, projection, sort, limit) {
    const coll = collection(ctx, name);
    if (!coll) {
      return null;
    }
    let cursor = coll.find(filter, projection ? { projection } : {});
    if (sort) {
      cursor = cursor.sort(sort);
    }
    if (limit) {
      cursor = cursor.limit(limit);
    }
    return cursor.toArray();
  }

  async function distinctValues(ctx, name, field, filter = {}) {
    const coll = collection(ctx, name);
    return coll ? coll.distinct(field, filter) : null;
  }

  function daysAgo(ctx, days) {
    return new Date(ctx.now.getTime() - days * DAY_MS);
  }

  function unavailableNoDb() {
    return UNAVAILABLE('mongodb is not connected');
  }

  /* ---------------------------------------------------------------- */
  /* Sections                                                          */
  /* ---------------------------------------------------------------- */

  async function healthSection() {
    const startedAt = Date.now();
    const [mongodb, meili] = await Promise.all([pingMongo(), deps.meili()]);
    const meiliState = meiliStatus(meili);
    return {
      status: mongodb === 'ok' && meiliState === 'ok' ? 'ok' : 'degraded',
      checks: { server: 'ok', mongodb, meilisearch: meiliState },
      responseMs: Date.now() - startedAt,
    };
  }

  async function hostSection() {
    const host = await deps.host();
    const [mongodb, meili] = await Promise.all([pingMongo(), deps.meili()]);
    return {
      ...host,
      services: {
        mongodb,
        meilisearch: meiliStatus(meili),
      },
    };
  }

  async function versionsSection(ctx) {
    const buildSha = process.env.GIT_SHA || null;
    if (!buildSha) {
      return UNAVAILABLE('GIT_SHA is not present in the deploy environment');
    }
    let mongoVersion = null;
    try {
      const info = await ctx.db.admin().serverInfo();
      mongoVersion = typeof info?.version === 'string' ? info.version : null;
    } catch {
      /* keep null */
    }
    return {
      buildSha,
      deployedAt: process.env.DEPLOYED_AT || null,
      nodeVersion: process.version,
      mongoVersion,
    };
  }

  async function usersSection(ctx) {
    const users = await findDocs(
      ctx,
      'users',
      {},
      {
        _id: 1,
        name: 1,
        email: 1,
        role: 1,
        emailVerified: 1,
        twoFactorEnabled: 1,
        createdAt: 1,
      },
    );
    if (users == null) {
      return unavailableNoDb();
    }
    const now = ctx.now;
    const activeIds = {
      24: new Set(
        (await distinctValues(ctx, 'messages', 'user', { createdAt: { $gte: daysAgo(ctx, 1) } })) ??
          [],
      ),
      7: new Set(
        (await distinctValues(ctx, 'messages', 'user', { createdAt: { $gte: daysAgo(ctx, 7) } })) ??
          [],
      ),
      30: new Set(
        (await distinctValues(ctx, 'messages', 'user', {
          createdAt: { $gte: daysAgo(ctx, 30) },
        })) ?? [],
      ),
    };
    const byRole = {};
    let verified = 0;
    let twoFactorEnabled = 0;
    let newToday = 0;
    let new7d = 0;
    let new30d = 0;
    let inactive30d = 0;
    let inactive60d = 0;
    let inactive90d = 0;
    const startToday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    for (const user of users) {
      byRole[user.role ?? 'USER'] = (byRole[user.role ?? 'USER'] ?? 0) + 1;
      if (user.emailVerified) verified += 1;
      if (user.twoFactorEnabled) twoFactorEnabled += 1;
      const created = user.createdAt instanceof Date ? user.createdAt : new Date(user.createdAt);
      const id = String(user._id);
      if (created >= startToday) newToday += 1;
      if (created >= daysAgo(ctx, 7)) new7d += 1;
      if (created >= daysAgo(ctx, 30)) new30d += 1;
      if (created < daysAgo(ctx, 30) && !activeIds[30].has(id)) inactive30d += 1;
      if (created < daysAgo(ctx, 60) && !activeIds[30].has(id)) inactive60d += 1;
      if (created < daysAgo(ctx, 90) && !activeIds[30].has(id)) inactive90d += 1;
    }

    const limit = Math.min(
      MAX_LIST,
      Math.max(1, Number.parseInt(ctx.query.limit ?? '50', 10) || 50),
    );
    const search = typeof ctx.query.q === 'string' ? ctx.query.q.trim() : '';
    const listFilter = search
      ? {
          $or: [
            { name: { $regex: escapeRegex(search), $options: 'i' } },
            { email: { $regex: escapeRegex(search), $options: 'i' } },
          ],
        }
      : {};
    const list = await findDocs(
      ctx,
      'users',
      listFilter,
      { _id: 1, name: 1, email: 1, role: 1, emailVerified: 1, createdAt: 1 },
      { createdAt: -1 },
      limit,
    );

    return {
      total: users.length,
      verified,
      twoFactorEnabled,
      byRole,
      newToday,
      new7d,
      new30d,
      active24h: activeIds[24].size,
      active7d: activeIds[7].size,
      active30d: activeIds[30].size,
      inactive30d,
      inactive60d,
      inactive90d,
      list: (list ?? []).map((user) => ({
        id: String(user._id),
        name: user.name ?? null,
        email: user.email ?? null,
        role: user.role ?? null,
        emailVerified: Boolean(user.emailVerified),
        createdAt: user.createdAt ?? null,
      })),
    };
  }

  async function engagementSection(ctx) {
    const dau = (
      (await distinctValues(ctx, 'messages', 'user', { createdAt: { $gte: daysAgo(ctx, 1) } })) ??
      []
    ).length;
    const wau = (
      (await distinctValues(ctx, 'messages', 'user', { createdAt: { $gte: daysAgo(ctx, 7) } })) ??
      []
    ).length;
    const mau = (
      (await distinctValues(ctx, 'messages', 'user', { createdAt: { $gte: daysAgo(ctx, 30) } })) ??
      []
    ).length;
    const messages7d = await countDocs(ctx, 'messages', { createdAt: { $gte: daysAgo(ctx, 7) } });
    if (messages7d == null) {
      return unavailableNoDb();
    }

    const retentionByWeek = [];
    for (let index = 6; index >= 1; index -= 1) {
      const start = weekStart(new Date(ctx.now.getTime() - index * 7 * DAY_MS));
      const end = new Date(start.getTime() + 7 * DAY_MS);
      const cohort = await findDocs(
        ctx,
        'users',
        { createdAt: { $gte: start, $lt: end } },
        { _id: 1 },
      );
      if (cohort == null) {
        break;
      }
      const ids = cohort.map((user) => String(user._id));
      let activeWeek1 = 0;
      let activeWeek4 = 0;
      if (ids.length > 0) {
        const week1 = new Set(
          (await distinctValues(ctx, 'messages', 'user', {
            user: { $in: ids },
            createdAt: { $gte: start, $lt: end },
          })) ?? [],
        );
        const week4Start = new Date(start.getTime() + 28 * DAY_MS);
        const week4 = new Set(
          (await distinctValues(ctx, 'messages', 'user', {
            user: { $in: ids },
            createdAt: { $gte: week4Start, $lt: new Date(week4Start.getTime() + 7 * DAY_MS) },
          })) ?? [],
        );
        activeWeek1 = ids.filter((id) => week1.has(id)).length;
        activeWeek4 = ids.filter((id) => week4.has(id)).length;
      }
      retentionByWeek.push({
        weekStart: isoDay(start),
        cohortSize: ids.length,
        activeWeek1,
        activeWeek4,
      });
    }

    return {
      dau,
      wau,
      mau,
      stickiness: ratio(dau, mau),
      messagesPerActiveUser: ratio(messages7d, wau),
      retentionByWeek,
    };
  }

  async function convosSection(ctx) {
    const [total, today, week, messagesTotal, messagesToday, messages7d] = await Promise.all([
      countDocs(ctx, 'conversations'),
      countDocs(ctx, 'conversations', { createdAt: { $gte: daysAgo(ctx, 1) } }),
      countDocs(ctx, 'conversations', { createdAt: { $gte: daysAgo(ctx, 7) } }),
      countDocs(ctx, 'messages'),
      countDocs(ctx, 'messages', { createdAt: { $gte: daysAgo(ctx, 1) } }),
      countDocs(ctx, 'messages', { createdAt: { $gte: daysAgo(ctx, 7) } }),
    ]);
    if (total == null) {
      return unavailableNoDb();
    }
    return {
      conversationsTotal: total,
      conversationsToday: today,
      conversations7d: week,
      messagesTotal,
      messagesToday,
      messages7d,
      avgMessagesPerConvo: ratio(messagesTotal ?? 0, total),
      activeUsers24h: (
        (await distinctValues(ctx, 'messages', 'user', { createdAt: { $gte: daysAgo(ctx, 1) } })) ??
        []
      ).length,
      activeUsers7d: (
        (await distinctValues(ctx, 'messages', 'user', { createdAt: { $gte: daysAgo(ctx, 7) } })) ??
        []
      ).length,
    };
  }

  async function usageSection(ctx) {
    const transactions = await findDocs(
      ctx,
      'transactions',
      { createdAt: { $gte: daysAgo(ctx, 30) } },
      { createdAt: 1, model: 1, tokenType: 1, rawAmount: 1 },
    );
    if (transactions == null) {
      return unavailableNoDb();
    }
    const days = new Map();
    const models7d = new Map();
    const totals = { tokensIn: 0, tokensOut: 0, requests: 0 };
    const weekAgo = daysAgo(ctx, 7);
    for (const row of transactions) {
      const date = isoDay(row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt));
      const model = row.model ?? 'unknown';
      const tokens = Math.abs(Number(row.rawAmount) || 0);
      const isPrompt = row.tokenType === 'prompt';
      const key = `${date}|${model}`;
      const day = days.get(key) ?? { date, model, tokensIn: 0, tokensOut: 0, requests: 0 };
      if (isPrompt) {
        day.tokensIn += tokens;
        day.requests += 1;
        totals.tokensIn += tokens;
        totals.requests += 1;
      } else {
        day.tokensOut += tokens;
        totals.tokensOut += tokens;
      }
      days.set(key, day);
      if ((row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)) >= weekAgo) {
        const entry = models7d.get(model) ?? { model, tokensIn: 0, tokensOut: 0, requests: 0 };
        if (isPrompt) {
          entry.tokensIn += tokens;
          entry.requests += 1;
        } else {
          entry.tokensOut += tokens;
        }
        models7d.set(model, entry);
      }
    }
    return {
      days: [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
      totals,
      perModel7d: [...models7d.values()].sort(
        (a, b) => b.tokensIn + b.tokensOut - (a.tokensIn + a.tokensOut),
      ),
    };
  }

  async function tiersSection(ctx) {
    const subscriptions = await findDocs(
      ctx,
      'subscriptions',
      {},
      { plan: 1, status: 1, createdAt: 1, updatedAt: 1 },
    );
    if (subscriptions == null) {
      return unavailableNoDb();
    }
    const distribution = {};
    for (const subscription of subscriptions) {
      const plan = subscription.plan ?? 'unknown';
      distribution[plan] = (distribution[plan] ?? 0) + 1;
    }
    const totalUsers = (await countDocs(ctx, 'users')) ?? 0;
    const paid = subscriptions.filter((subscription) => subscription.status === 'active').length;
    if (totalUsers > paid) {
      distribution.free = (distribution.free ?? 0) + (totalUsers - paid);
    }
    return {
      distribution,
      changes7d: { upgraded: null, downgraded: null },
      trialToPaid30d: null,
    };
  }

  async function paymentsSection(ctx) {
    const payments = await findDocs(
      ctx,
      'billingpayments',
      {},
      { externalId: 1, email: 1, amount: 1, currency: 1, status: 1, plan: 1, createdAt: 1 },
      { createdAt: -1 },
    );
    if (payments == null) {
      return unavailableNoDb();
    }
    const now = ctx.now;
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const byMonth = new Map();
    let allTime = 0;
    let month = 0;
    let today = 0;
    const states = { active: 0, pastDue: 0, canceled: 0, paused: 0 };
    let refunds30d = 0;
    for (const payment of payments) {
      const amount = Number(payment.amount) || 0;
      const created =
        payment.createdAt instanceof Date ? payment.createdAt : new Date(payment.createdAt);
      allTime += amount;
      if (created >= monthStart) month += amount;
      if (created >= todayStart) today += amount;
      const key = created.toISOString().slice(0, 7);
      const bucket = byMonth.get(key) ?? { month: key, total: 0, count: 0 };
      bucket.total += amount;
      bucket.count += 1;
      byMonth.set(key, bucket);
      const status = String(payment.status ?? '').toLowerCase();
      if (status === 'active' || status === 'succeeded' || status === 'paid') states.active += 1;
      else if (status.includes('past') || status.includes('due')) states.pastDue += 1;
      else if (status.includes('cancel')) states.canceled += 1;
      else if (status.includes('pause')) states.paused += 1;
      if (status.includes('refund') && created >= daysAgo(ctx, 30)) refunds30d += 1;
    }
    return {
      records: payments.slice(0, 100).map((payment) => ({
        id: payment.externalId ?? null,
        date: payment.createdAt ?? null,
        amount: Number(payment.amount) || 0,
        currency: payment.currency ?? 'INR',
        status: payment.status ?? null,
        plan: payment.plan ?? null,
        customerEmail: payment.email ?? null,
      })),
      sums: {
        allTime,
        month,
        today,
        byMonth: [...byMonth.values()].sort((a, b) => (a.month < b.month ? 1 : -1)),
      },
      webhook: { delivered: null, failed: null, lastFailureAt: null },
      states,
      refunds30d,
    };
  }

  async function authSection(ctx) {
    const users = await findDocs(ctx, 'users', {}, { twoFactorEnabled: 1 });
    if (users == null) {
      return unavailableNoDb();
    }
    const mfaEnabled = users.filter((user) => user.twoFactorEnabled).length;
    const activeSessions = await countDocs(ctx, 'sessions', { expiration: { $gt: ctx.now } });
    return {
      signups7d: await countDocs(ctx, 'users', { createdAt: { $gte: daysAgo(ctx, 7) } }),
      logins24h: null,
      failedLogins24h: null,
      passwordResets24h: null,
      mfaEnabledShare: ratio(mfaEnabled, users.length),
      activeSessions,
    };
  }

  async function securitySection(ctx) {
    const recent = await findDocs(
      ctx,
      'auditlogs',
      {},
      { actor: 1, action: 1, target: 1, createdAt: 1 },
      { createdAt: -1 },
      20,
    );
    if (recent == null) {
      return unavailableNoDb();
    }
    const roleChanges7d = await countDocs(ctx, 'auditlogs', {
      action: { $regex: /role/i },
      createdAt: { $gte: daysAgo(ctx, 7) },
    });
    return {
      adminActions: recent.map((entry) => ({
        at: entry.createdAt ?? null,
        actor: entry.actor?.name ?? null,
        action: entry.action ?? null,
        target: entry.target?.name ?? entry.target?.type ?? null,
      })),
      roleChanges7d,
      keyCreates7d: await countDocs(ctx, 'keys', { createdAt: { $gte: daysAgo(ctx, 7) } }),
      keyRevokes7d: null,
    };
  }

  async function metricsSection() {
    return deps.metrics();
  }

  async function filesSection(ctx) {
    const files = await findDocs(ctx, 'files', {}, { bytes: 1, createdAt: 1 });
    if (files == null) {
      return unavailableNoDb();
    }
    const totalBytes = files.reduce((total, file) => total + (Number(file.bytes) || 0), 0);
    let uploadsDirBytes = null;
    try {
      uploadsDirBytes = await deps.uploadsBytes();
    } catch {
      /* leave null */
    }
    return {
      fileCount: files.length,
      totalBytes,
      uploadsDirBytes,
      growthBytes24h: null,
      daysToFullEstimate: null,
    };
  }

  async function agentsSection(ctx) {
    const [agentDefinitions, apiKeys, skills] = await Promise.all([
      countDocs(ctx, 'agents'),
      countDocs(ctx, 'agentapikeys'),
      countDocs(ctx, 'skills'),
    ]);
    if (agentDefinitions == null) {
      return unavailableNoDb();
    }
    return { agentDefinitions, apiKeys, skills, topSkills: [] };
  }

  async function schedulesSection(ctx) {
    const [
      total,
      active,
      runSuccess,
      runFailed,
      workflowsTotal,
      workflowsActive,
      workflowSuccess,
      workflowFailed,
    ] = await Promise.all([
      countDocs(ctx, 'schedules'),
      countDocs(ctx, 'schedules', { enabled: true }),
      countDocs(ctx, 'scheduleruns', { status: 'success', createdAt: { $gte: daysAgo(ctx, 7) } }),
      countDocs(ctx, 'scheduleruns', {
        status: { $ne: 'success' },
        createdAt: { $gte: daysAgo(ctx, 7) },
      }),
      countDocs(ctx, 'workflows'),
      countDocs(ctx, 'workflows', { enabled: true }),
      countDocs(ctx, 'workflow_runs', { status: 'success', createdAt: { $gte: daysAgo(ctx, 7) } }),
      countDocs(ctx, 'workflow_runs', {
        status: { $ne: 'success' },
        createdAt: { $gte: daysAgo(ctx, 7) },
      }),
    ]);
    if (total == null) {
      return unavailableNoDb();
    }
    return {
      active,
      total,
      runs7d: { success: runSuccess ?? 0, failed: runFailed ?? 0 },
      workflows: {
        active: workflowsActive ?? 0,
        total: workflowsTotal ?? 0,
        runs7d: { success: workflowSuccess ?? 0, failed: workflowFailed ?? 0 },
      },
    };
  }

  async function searchSection() {
    const meili = await deps.meili();
    if (meili?.available === false) {
      return UNAVAILABLE(meili.reason ?? 'meilisearch is not configured');
    }
    return {
      available: meili?.health === 'ok',
      documents: meili?.documents ?? null,
      indexLagSeconds: meili?.indexLagSeconds ?? null,
    };
  }

  async function providersSection() {
    return deps.providers();
  }

  async function feedbackSection(ctx) {
    const items = await findDocs(
      ctx,
      'feedback',
      {},
      { subject: 1, message: 1, rating: 1, status: 1, email: 1, createdAt: 1 },
      { createdAt: -1 },
      1000,
    );
    if (items == null) {
      return unavailableNoDb();
    }
    const byRating = {};
    let open = 0;
    let resolved = 0;
    for (const item of items) {
      const rating = String(item.rating ?? 'none');
      byRating[rating] = (byRating[rating] ?? 0) + 1;
      if (String(item.status ?? '').toLowerCase() === 'resolved') resolved += 1;
      else open += 1;
    }
    return {
      counts: { byRating, open, resolved },
      recent: items.slice(0, 20).map((item) => ({
        at: item.createdAt ?? null,
        subject: item.subject ?? null,
        message: item.message ?? null,
        rating: item.rating ?? null,
        status: item.status ?? null,
        email: item.email ?? null,
      })),
    };
  }

  const sections = {
    health: healthSection,
    host: hostSection,
    versions: versionsSection,
    users: usersSection,
    engagement: engagementSection,
    convos: convosSection,
    usage: usageSection,
    cost: async () => UNAVAILABLE('no model price table'),
    tiers: tiersSection,
    payments: paymentsSection,
    quota: async () =>
      UNAVAILABLE('rate-limit and quota-exhaustion events are enforced but not persisted'),
    auth: authSection,
    security: securitySection,
    email: async () => UNAVAILABLE('no email transport log is persisted'),
    metrics: metricsSection,
    files: filesSection,
    agents: agentsSection,
    schedules: schedulesSection,
    search: searchSection,
    providers: providersSection,
    feedback: feedbackSection,
  };

  router.get('/', async (req, res) => {
    if (!authorized(req)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const requested = [].concat(req.query.section ?? []);
    const names =
      requested.length === 0 || requested.includes('all')
        ? ALL_SECTIONS
        : [...new Set(requested.filter((name) => Object.hasOwn(sections, name)))];

    const ctx = context(req);
    const generatedAt = new Date().toISOString();
    const entries = await Promise.all(
      names.map(async (name) => {
        try {
          const value = await sections[name](ctx);
          return [name, { asOf: generatedAt, ...value }];
        } catch (error) {
          logger.warn(`[ops-summary] section ${name} failed`, error);
          return [name, { asOf: generatedAt, ...UNAVAILABLE('section failed to compute') }];
        }
      }),
    );

    const payload = {
      ok: true,
      schemaVersion: SCHEMA_VERSION,
      generatedAt,
      sections: Object.fromEntries(entries),
    };
    const body = JSON.stringify(payload);
    if (/\bgzip\b/.test(req.get('accept-encoding') ?? '') && body.length > 1024) {
      const compressed = zlib.gzipSync(body);
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.send(compressed);
      return;
    }
    res.type('application/json').send(body);
  });

  return router;
}

module.exports = createOpsSummaryRouter();
module.exports.createOpsSummaryRouter = createOpsSummaryRouter;
