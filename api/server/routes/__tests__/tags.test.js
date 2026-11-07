const express = require('express');
const request = require('supertest');

/**
 * Integration tests for `api/server/routes/tags.js`.
 *
 * The route file is exercised through real Express wiring: the real
 * `generateCheckAccess` factory from `@librechat/api` performs the BOOKMARKS:USE
 * role check, so a request only reaches a handler when the mocked role really
 * grants the permission. Only the two process-boundary collaborators are
 * replaced — `~/server/middleware` (so a test can control the caller and force
 * an unauthenticated response) and `~/models` (so the conversation-tag store is
 * an in-memory fake rather than MongoDB). Everything asserted below is therefore
 * the route's own status mapping, parameter handling and pass-through of the
 * authenticated user id, not the fake talking to itself.
 */

/** Backing store for the `~/models` fake; `mock`-prefixed so `jest.mock` may close over it. */
const mockTagStore = {
  rows: new Map(),
  reset() {
    this.rows.clear();
  },
};

/** The role `getRoleByName` returns; granting/denying BOOKMARKS:USE drives 200 vs 403. */
let mockRole = { permissions: { BOOKMARKS: { USE: true } } };

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
  const keyOf = (userId, tag) => `${userId}:${tag}`;
  const strip = ({ userId: _userId, ...tag }) => tag;

  return {
    getRoleByName: jest.fn(async () => mockRole),
    getConversationTags: jest.fn(async (userId) =>
      [...mockTagStore.rows.values()]
        .filter((row) => row.userId === userId)
        .map((row) => strip(row)),
    ),
    createConversationTag: jest.fn(async (userId, body) => {
      const row = { tag: body.tag, description: body.description ?? '', userId };
      mockTagStore.rows.set(keyOf(userId, row.tag), row);
      return strip(row);
    }),
    updateConversationTag: jest.fn(async (userId, tag, body) => {
      const key = keyOf(userId, tag);
      const row = mockTagStore.rows.get(key);
      if (row == null) {
        return null;
      }
      const next = { ...row, ...body, tag, userId };
      mockTagStore.rows.set(key, next);
      return strip(next);
    }),
    deleteConversationTag: jest.fn(async (userId, tag) => {
      const key = keyOf(userId, tag);
      const row = mockTagStore.rows.get(key);
      if (row == null) {
        return null;
      }
      mockTagStore.rows.delete(key);
      return strip(row);
    }),
    updateTagsForConversation: jest.fn(async (userId, conversationId, tags) => ({
      conversationId,
      tags,
      userId,
    })),
  };
});

const tagsRouter = require('../tags');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/tags', tagsRouter);
  return app;
};

describe('conversation tag routes', () => {
  beforeEach(() => {
    mockRole = { permissions: { BOOKMARKS: { USE: true } } };
    mockAuthUser = { id: 'user-1', role: 'USER' };
    mockAuthRejection = null;
    mockTagStore.reset();
  });

  describe('authentication and authorization', () => {
    it('answers 401 for an unauthenticated list request and never touches the store', async () => {
      mockAuthRejection = { status: 401, error: 'Unauthorized' };

      const response = await request(buildApp()).get('/api/tags');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
      expect(mockMiddleware.requireJwtAuth).toHaveBeenCalled();
    });

    it('blocks a mutating request too, so nothing is written for an unauthenticated caller', async () => {
      mockAuthRejection = { status: 401, error: 'Unauthorized' };

      const response = await request(buildApp()).post('/api/tags').send({ tag: 'nope' });

      expect(response.status).toBe(401);
      expect(mockTagStore.rows.size).toBe(0);
    });

    it('answers 403 when the caller role lacks BOOKMARKS:USE', async () => {
      mockRole = { permissions: { BOOKMARKS: { USE: false } } };

      const response = await request(buildApp()).get('/api/tags');

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ message: 'Forbidden: Insufficient permissions' });
    });
  });

  describe('GET / — list', () => {
    it('answers 200 with the caller tags scoped by user id', async () => {
      await request(buildApp()).post('/api/tags').send({ tag: 'mine', description: 'd' });
      mockAuthUser = { id: 'user-2', role: 'USER' };
      await request(buildApp()).post('/api/tags').send({ tag: 'theirs' });

      mockAuthUser = { id: 'user-1', role: 'USER' };
      const response = await request(buildApp()).get('/api/tags');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([{ tag: 'mine', description: 'd' }]);
    });

    it('answers 404 when the data layer reports no tag collection', async () => {
      const { getConversationTags } = require('~/models');
      getConversationTags.mockResolvedValueOnce(null);

      const response = await request(buildApp()).get('/api/tags');

      expect(response.status).toBe(404);
    });
  });

  describe('POST / — create', () => {
    it('answers 200 with the created tag and passes the authenticated user through', async () => {
      mockAuthUser = { id: 'user-42', role: 'USER' };

      const response = await request(buildApp())
        .post('/api/tags')
        .send({ tag: 'follow-up', description: 'needs reply' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ tag: 'follow-up', description: 'needs reply' });
      expect(mockTagStore.rows.get('user-42:follow-up')).toMatchObject({ userId: 'user-42' });
    });
  });

  describe('PUT /:tag — update', () => {
    it('answers 200 with the updated tag', async () => {
      await request(buildApp()).post('/api/tags').send({ tag: 'urgent', description: 'old' });

      const response = await request(buildApp())
        .put('/api/tags/urgent')
        .send({ description: 'new' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ tag: 'urgent', description: 'new' });
    });

    it('answers 404 for a tag the caller does not own', async () => {
      await request(buildApp()).post('/api/tags').send({ tag: 'mine' });
      mockAuthUser = { id: 'user-2', role: 'USER' };

      const response = await request(buildApp()).put('/api/tags/mine').send({ description: 'x' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Tag not found' });
    });
  });

  describe('DELETE /:tag — delete', () => {
    it('answers 200 with the deleted tag and removes it from the store', async () => {
      await request(buildApp()).post('/api/tags').send({ tag: 'temp' });

      const response = await request(buildApp()).delete('/api/tags/temp');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ tag: 'temp', description: '' });
      expect(mockTagStore.rows.size).toBe(0);
    });

    it('answers 404 when the tag does not exist', async () => {
      const response = await request(buildApp()).delete('/api/tags/ghost');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Tag not found' });
    });
  });

  describe('PUT /convo/:conversationId — set a conversation tags', () => {
    it('answers 200 with the conversation tag payload', async () => {
      const response = await request(buildApp())
        .put('/api/tags/convo/convo-9')
        .send({ tags: ['a', 'b'] });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        conversationId: 'convo-9',
        tags: ['a', 'b'],
        userId: 'user-1',
      });
    });

    it('does not mistake the convo route for a single tag', async () => {
      const response = await request(buildApp()).put('/api/tags/convo/convo-9').send({ tags: [] });

      expect(response.status).toBe(200);
      expect(response.body.conversationId).toBe('convo-9');
    });
  });
});
