const express = require('express');
const request = require('supertest');

/**
 * Integration tests for `api/server/routes/apiKeys.js`.
 *
 * The real `createApiKeyHandlers` factory and the real `generateCheckAccess`
 * middleware from `@librechat/api` run here, so the REMOTE_AGENTS:USE role gate,
 * name validation, status codes and response bodies are the shipped
 * implementations rather than a stand-in. Only `~/server/middleware` (the JWT
 * guard) and `~/models` (the agent-key store plus `getRoleByName`) are mocked;
 * the key rows live in an in-memory fake so the lifecycle assertions observe the
 * route's own mapping of data-layer results to HTTP.
 */

/** Backing store for the `~/models` fake; `mock`-prefixed so `jest.mock` may close over it. */
const mockKeyStore = {
  rows: new Map(),
  reset() {
    this.rows.clear();
  },
};

/** The role `getRoleByName` returns; granting/denying REMOTE_AGENTS:USE drives 201 vs 403. */
let mockRole = { permissions: { REMOTE_AGENTS: { USE: true } } };

/** The caller `requireJwtAuth` stands in for, or the refusal it should give instead. */
let mockAuthUser = { id: 'user-1', role: 'USER' };
let mockAuthRejection = null;

/** The middleware stand-in itself, so a test can assert it ran. */
const mockMiddleware = {};

jest.mock('~/server/middleware', () => {
  const requireJwtAuth = jest.fn((req, res, next) => {
    if (mockAuthRejection) {
      return res.status(mockAuthRejection.status).json({ error: mockAuthRejection.error });
    }
    req.user = mockAuthUser;
    return next();
  });
  mockMiddleware.requireJwtAuth = requireJwtAuth;
  return { requireJwtAuth };
});

jest.mock('~/models', () => {
  const owned = (userId) => [...mockKeyStore.rows.values()].filter((row) => row.userId === userId);

  return {
    getRoleByName: jest.fn(async () => mockRole),
    createAgentApiKey: jest.fn(async ({ userId, name, expiresAt }) => {
      const row = {
        id: `key-${mockKeyStore.rows.size + 1}`,
        name,
        key: `sk-${mockKeyStore.rows.size + 1}-secret`,
        keyPrefix: `sk-${mockKeyStore.rows.size + 1}`,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: expiresAt ?? undefined,
        userId,
      };
      mockKeyStore.rows.set(row.id, row);
      return row;
    }),
    listAgentApiKeys: jest.fn(async (userId) =>
      owned(userId).map(({ userId: _userId, key: _key, ...rest }) => rest),
    ),
    getAgentApiKeyById: jest.fn(async (keyId, userId) => {
      const row = mockKeyStore.rows.get(keyId);
      if (row == null || row.userId !== userId) {
        return null;
      }
      const { userId: _userId, key: _key, ...rest } = row;
      return rest;
    }),
    deleteAgentApiKey: jest.fn(async (keyId, userId) => {
      const row = mockKeyStore.rows.get(keyId);
      if (row == null || row.userId !== userId) {
        return false;
      }
      mockKeyStore.rows.delete(keyId);
      return true;
    }),
  };
});

const apiKeysRouter = require('../apiKeys');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/api-keys', apiKeysRouter);
  return app;
};

describe('agent API key routes', () => {
  beforeEach(() => {
    mockRole = { permissions: { REMOTE_AGENTS: { USE: true } } };
    mockAuthUser = { id: 'user-1', role: 'USER' };
    mockAuthRejection = null;
    mockKeyStore.reset();
  });

  describe('authentication and authorization', () => {
    it('answers 401 for an unauthenticated create and writes nothing', async () => {
      mockAuthRejection = { status: 401, error: 'Unauthorized' };

      const response = await request(buildApp()).post('/api/api-keys').send({ name: 'nope' });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
      expect(mockKeyStore.rows.size).toBe(0);
      expect(mockMiddleware.requireJwtAuth).toHaveBeenCalled();
    });

    it('answers 401 for an unauthenticated list', async () => {
      mockAuthRejection = { status: 401, error: 'Unauthorized' };

      const response = await request(buildApp()).get('/api/api-keys');

      expect(response.status).toBe(401);
    });

    it('answers 403 when the caller role lacks REMOTE_AGENTS:USE', async () => {
      mockRole = { permissions: { REMOTE_AGENTS: { USE: false } } };

      const response = await request(buildApp()).get('/api/api-keys');

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ message: 'Forbidden: Insufficient permissions' });
    });
  });

  describe('POST / — create', () => {
    it('answers 400 when the name is missing', async () => {
      const response = await request(buildApp()).post('/api/api-keys').send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'API key name is required' });
      expect(mockKeyStore.rows.size).toBe(0);
    });

    it('answers 400 when the name is blank', async () => {
      const response = await request(buildApp()).post('/api/api-keys').send({ name: '   ' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'API key name is required' });
    });

    it('answers 201 with the new key and passes the authenticated user through', async () => {
      mockAuthUser = { id: 'user-42', role: 'USER' };

      const response = await request(buildApp())
        .post('/api/api-keys')
        .send({ name: '  ci-bot  ' });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ name: 'ci-bot', keyPrefix: expect.any(String) });
      expect(response.body.key).toEqual(expect.any(String));
      expect(mockKeyStore.rows.get(response.body.id)).toMatchObject({ userId: 'user-42' });
    });

    it('answers 201 and forwards an expiry when supplied', async () => {
      const response = await request(buildApp())
        .post('/api/api-keys')
        .send({ name: 'temp', expiresAt: '2026-12-31' });

      expect(response.status).toBe(201);
      expect(response.body.expiresAt).toBe('2026-12-31T00:00:00.000Z');
    });
  });

  describe('GET / — list', () => {
    it('answers 200 with only the caller keys and never the secret', async () => {
      await request(buildApp()).post('/api/api-keys').send({ name: 'mine' });
      mockAuthUser = { id: 'user-2', role: 'USER' };
      await request(buildApp()).post('/api/api-keys').send({ name: 'theirs' });

      mockAuthUser = { id: 'user-1', role: 'USER' };
      const response = await request(buildApp()).get('/api/api-keys');

      expect(response.status).toBe(200);
      expect(response.body.keys).toHaveLength(1);
      expect(response.body.keys[0].name).toBe('mine');
      expect(response.body.keys[0]).not.toHaveProperty('key');
    });
  });

  describe('GET /:id — retrieve', () => {
    it('answers 200 with the key metadata', async () => {
      const created = await request(buildApp()).post('/api/api-keys').send({ name: 'fetch-me' });

      const response = await request(buildApp()).get(`/api/api-keys/${created.body.id}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: created.body.id, name: 'fetch-me' });
      expect(response.body).not.toHaveProperty('key');
    });

    it('answers 404 for a key that does not exist', async () => {
      const response = await request(buildApp()).get('/api/api-keys/missing-key');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'API key not found' });
    });

    it('answers 404 for a key owned by another user', async () => {
      const created = await request(buildApp()).post('/api/api-keys').send({ name: 'mine' });
      mockAuthUser = { id: 'user-2', role: 'USER' };

      const response = await request(buildApp()).get(`/api/api-keys/${created.body.id}`);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'API key not found' });
    });
  });

  describe('DELETE /:id', () => {
    it('answers 204 and removes the key', async () => {
      const created = await request(buildApp()).post('/api/api-keys').send({ name: 'bye' });

      const response = await request(buildApp()).delete(`/api/api-keys/${created.body.id}`);

      expect(response.status).toBe(204);
      expect(mockKeyStore.rows.has(created.body.id)).toBe(false);
    });

    it('answers 404 when the key does not exist', async () => {
      const response = await request(buildApp()).delete('/api/api-keys/missing-key');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'API key not found' });
    });
  });
});
