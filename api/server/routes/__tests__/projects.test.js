const express = require('express');
const request = require('supertest');

/**
 * Integration tests for `api/server/routes/projects.js`.
 *
 * The real `createProjectHandlers` factory from `@librechat/api` runs behind a
 * real Express router, so request parsing, `isValidObjectIdString` gating, body
 * validation and status mapping are the shipped implementations. Only the two
 * process-boundary collaborators are replaced: the JWT guard (so a test can
 * choose the caller or force a refusal) and `~/models` (so the six project data
 * methods are an in-memory fake instead of MongoDB). The assertions read the
 * fake's own rows and the handler's responses, which is the behavior an HTTP
 * client of `/api/projects` actually observes.
 */

/** Backing store for the `~/models` fake; `mock`-prefixed so `jest.mock` may close over it. */
const mockProjectStore = {
  rows: new Map(),
  reset() {
    this.rows.clear();
  },
};

/** The caller the guard installs, or the refusal it should give instead. */
let mockAuthUser = { id: 'user-1' };
let mockAuthRejection = null;

/** The middleware stand-in itself, so a test can assert it ran. */
const mockMiddleware = {};

jest.mock('~/server/middleware/requireJwtAuth', () => {
  const requireJwtAuth = jest.fn((req, res, next) => {
    if (mockAuthRejection) {
      return res.status(mockAuthRejection.status).json({ error: mockAuthRejection.error });
    }
    req.user = mockAuthUser;
    return next();
  });
  mockMiddleware.requireJwtAuth = requireJwtAuth;
  return requireJwtAuth;
});

jest.mock('~/models', () => {
  const owned = (userId) => [...mockProjectStore.rows.values()].filter((row) => row.userId === userId);
  // The route gates id-taking handlers on `isValidObjectIdString`, so the fake
  // must mint real 24-char hex ids or every read/update/delete would 404.
  let sequence = 0;
  const nextId = () => (++sequence).toString(16).padStart(24, '0');

  return {
    listChatProjects: jest.fn(async (userId) => ({ projects: owned(userId), hasMore: false })),
    createChatProject: jest.fn(async (userId, input) => {
      const project = {
        id: nextId(),
        name: input.name,
        description: input.description,
        userId,
      };
      mockProjectStore.rows.set(project.id, project);
      return project;
    }),
    getChatProject: jest.fn(async (userId, projectId) => {
      const row = mockProjectStore.rows.get(projectId);
      return row != null && row.userId === userId ? row : null;
    }),
    updateChatProject: jest.fn(async (userId, projectId, patch) => {
      const row = mockProjectStore.rows.get(projectId);
      if (row == null || row.userId !== userId) {
        return null;
      }
      const next = { ...row, ...patch };
      mockProjectStore.rows.set(projectId, next);
      return next;
    }),
    deleteChatProject: jest.fn(async (userId, projectId) => {
      const row = mockProjectStore.rows.get(projectId);
      if (row == null || row.userId !== userId) {
        return { deletedCount: 0 };
      }
      mockProjectStore.rows.delete(projectId);
      return { deletedCount: 1 };
    }),
    assignConversationToProject: jest.fn(async (userId, conversationId, projectId) => {
      if (conversationId === 'missing-convo') {
        return null;
      }
      if (projectId === 'missing-project') {
        throw new Error('Project not found');
      }
      return { conversationId, projectId, userId };
    }),
  };
});

const projectsRouter = require('../projects');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/projects', projectsRouter);
  return app;
};

const VALID_ID = '507f1f77bcf86cd799439011';
const MISSING_ID = 'ffffffffffffffffffffffff';

describe('project routes', () => {
  beforeEach(() => {
    mockAuthUser = { id: 'user-1' };
    mockAuthRejection = null;
    mockProjectStore.reset();
  });

  describe('authentication', () => {
    it('answers 401 for an unauthenticated list request', async () => {
      mockAuthRejection = { status: 401, error: 'Unauthorized' };

      const response = await request(buildApp()).get('/api/projects');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
      expect(mockMiddleware.requireJwtAuth).toHaveBeenCalled();
    });

    it('blocks a create too, so an unauthenticated caller writes nothing', async () => {
      mockAuthRejection = { status: 401, error: 'Unauthorized' };

      const response = await request(buildApp()).post('/api/projects').send({ name: 'nope' });

      expect(response.status).toBe(401);
      expect(mockProjectStore.rows.size).toBe(0);
    });
  });

  describe('validation', () => {
    it('answers 400 when a create has no name', async () => {
      const response = await request(buildApp()).post('/api/projects').send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'name is required' });
      expect(mockProjectStore.rows.size).toBe(0);
    });

    it('answers 400 when a create name is only whitespace', async () => {
      const response = await request(buildApp()).post('/api/projects').send({ name: '   ' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'name is required' });
    });

    it('answers 400 when a patch name is blank', async () => {
      const created = await request(buildApp()).post('/api/projects').send({ name: 'keep' });
      expect(created.status).toBe(201);

      const response = await request(buildApp())
        .patch(`/api/projects/${created.body.id}`)
        .send({ name: '  ' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'name is required' });
    });

    it('answers 400 when assigning a non-string, non-null projectId', async () => {
      const response = await request(buildApp())
        .put('/api/projects/conversations/convo-1')
        .send({ projectId: 42 });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'projectId must be a string or null' });
    });
  });

  describe('success paths', () => {
    it('answers 201 with the created project', async () => {
      const response = await request(buildApp())
        .post('/api/projects')
        .send({ name: 'Roadmap', description: 'Q3' });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ name: 'Roadmap', description: 'Q3', userId: 'user-1' });
      expect(response.body.id).toEqual(expect.any(String));
    });

    it('answers 200 with only the caller projects on list', async () => {
      await request(buildApp()).post('/api/projects').send({ name: 'mine' });
      mockAuthUser = { id: 'user-2' };
      await request(buildApp()).post('/api/projects').send({ name: 'theirs' });

      mockAuthUser = { id: 'user-1' };
      const response = await request(buildApp()).get('/api/projects');

      expect(response.status).toBe(200);
      expect(response.body.projects).toHaveLength(1);
      expect(response.body.projects[0].name).toBe('mine');
    });

    it('answers 200 with a fetched project', async () => {
      const created = await request(buildApp()).post('/api/projects').send({ name: 'Docs' });

      const response = await request(buildApp()).get(`/api/projects/${created.body.id}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: created.body.id, name: 'Docs' });
    });

    it('answers 200 with the updated project', async () => {
      const created = await request(buildApp()).post('/api/projects').send({ name: 'Old' });

      const response = await request(buildApp())
        .patch(`/api/projects/${created.body.id}`)
        .send({ name: 'New' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: created.body.id, name: 'New' });
    });

    it('answers 200 with the delete result', async () => {
      const created = await request(buildApp()).post('/api/projects').send({ name: 'Temp' });

      const response = await request(buildApp()).delete(`/api/projects/${created.body.id}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ deletedCount: 1 });
      expect(mockProjectStore.rows.has(created.body.id)).toBe(false);
    });

    it('answers 200 when assigning a conversation', async () => {
      const created = await request(buildApp()).post('/api/projects').send({ name: 'Inbox' });

      const response = await request(buildApp())
        .put('/api/projects/conversations/convo-1')
        .send({ projectId: created.body.id });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ conversationId: 'convo-1', projectId: created.body.id, userId: 'user-1' });
    });
  });

  describe('404 responses', () => {
    it('answers 404 for a syntactically invalid project id without querying the store', async () => {
      const response = await request(buildApp()).get('/api/projects/not-an-object-id');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Project not found' });
      const { getChatProject } = require('~/models');
      expect(getChatProject).not.toHaveBeenCalled();
    });

    it('answers 404 for a valid but missing project id', async () => {
      const response = await request(buildApp()).get(`/api/projects/${VALID_ID}`);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Project not found' });
    });

    it('answers 404 when patching a missing project', async () => {
      const response = await request(buildApp())
        .patch(`/api/projects/${MISSING_ID}`)
        .send({ name: 'x' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Project not found' });
    });

    it('answers 404 when deleting a missing project', async () => {
      const response = await request(buildApp()).delete(`/api/projects/${MISSING_ID}`);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Project not found' });
    });

    it('answers 404 when assigning a conversation that does not exist', async () => {
      const response = await request(buildApp())
        .put('/api/projects/conversations/missing-convo')
        .send({ projectId: null });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Conversation not found' });
    });

    it('answers 404 when the data layer reports the target project missing', async () => {
      const response = await request(buildApp())
        .put('/api/projects/conversations/convo-1')
        .send({ projectId: 'missing-project' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Project not found' });
    });
  });
});
