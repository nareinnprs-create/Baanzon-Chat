import express from 'express';
import request from 'supertest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods, tenantStorage } from '@librechat/data-schemas';
import type { AllMethods, IUser } from '@librechat/data-schemas';
import type { ServerRequest } from '~/types';
import type { SkillTreeHandlersDeps } from './tree';
import { createSkillTreeHandlers } from './tree';

const tenantId = 'skill-tree-test';
const author = new Types.ObjectId();
const user = { id: author.toString(), _id: author, role: 'USER', tenantId } as IUser;

let server: MongoMemoryServer;
let db: AllMethods;
let app: express.Express;
let skillId: string;
let saveFile: jest.MockedFunction<SkillTreeHandlersDeps['saveSkillFileContent']>;
let strategyFunctions: jest.Mock;
const inTenant = <T>(fn: () => T) => tenantStorage.run({ tenantId }, fn);

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  createModels(mongoose);
  db = createMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  const { skill } = await inTenant(() =>
    db.createSkill({
      name: 'tree-skill',
      description: 'Use this skill to exercise the derived tree handlers.',
      body: '# Body\n\nInstructions',
      author,
      authorName: 'Test',
      tenantId,
    }),
  );
  skillId = skill._id.toString();

  saveFile = jest.fn(async ({ skillId: id, relativePath, content, mimeType }) => {
    await db.upsertSkillFile({
      skillId: id,
      relativePath,
      file_id: `f-${relativePath}`,
      filename: relativePath.split('/').pop() as string,
      filepath: `/tmp/${relativePath}`,
      source: 'local',
      mimeType,
      bytes: Buffer.byteLength(content),
      author,
      tenantId,
    });
    await db.updateSkillFileContent(id, relativePath, { content, isBinary: false });
    return { relativePath, bytes: Buffer.byteLength(content) };
  });
  strategyFunctions = jest.fn(() => ({}));

  const handlers = createSkillTreeHandlers({
    getSkillById: db.getSkillById,
    getSkillFileByPath: db.getSkillFileByPath,
    updateSkillFileContent: db.updateSkillFileContent,
    getStrategyFunctions: strategyFunctions,
    isValidObjectIdString: (id) => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id),
    listSkillTree: db.listSkillTree,
    renameSkillNode: db.renameSkillNode,
    deleteSkillNode: db.deleteSkillNode,
    saveSkillFileContent: saveFile,
  });

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    (req as ServerRequest).config = {} as ServerRequest['config'];
    tenantStorage.run({ tenantId }, next);
  });
  app.get('/skills/:id/tree', async (req, res) => {
    await handlers.getTree(req as ServerRequest, res);
  });
  app.post('/skills/:id/tree', async (req, res) => {
    await handlers.createNode(req as ServerRequest, res);
  });
  app.get('/skills/:id/tree/*nodePath/content', async (req, res) => {
    await handlers.getNodeContent(req as ServerRequest, res);
  });
  app.put('/skills/:id/tree/*nodePath/content', async (req, res) => {
    await handlers.updateNodeContent(req as ServerRequest, res);
  });
  app.patch('/skills/:id/tree/*nodePath', async (req, res) => {
    await handlers.updateNode(req as ServerRequest, res);
  });
  app.delete('/skills/:id/tree/*nodePath', async (req, res) => {
    await handlers.deleteNode(req as ServerRequest, res);
  });
});

describe('skill tree handlers', () => {
  it('serves the derived tree, always including SKILL.md', async () => {
    const first = await request(app).get(`/skills/${skillId}/tree`).expect(200);
    expect(first.body.nodes).toEqual([
      expect.objectContaining({ _id: 'SKILL.md', type: 'file', parentId: null, name: 'SKILL.md' }),
    ]);

    await request(app)
      .post(`/skills/${skillId}/tree`)
      .send({ type: 'file', name: 'run.sh', parentId: 'scripts', content: 'echo hi' })
      .expect(201);
    await request(app)
      .post(`/skills/${skillId}/tree`)
      .send({ type: 'file', name: 'notes.md', content: 'hello' })
      .expect(201);

    const tree = await request(app).get(`/skills/${skillId}/tree`).expect(200);
    const ids = tree.body.nodes.map((node: { _id: string }) => node._id);
    expect(ids).toContain('scripts');
    expect(ids).toContain('scripts/run.sh');
    expect(ids).toContain('notes.md');
  });

  it('returns an empty tree for external / unknown ids instead of erroring', async () => {
    const unknown = new Types.ObjectId().toString();
    const empty = await request(app).get(`/skills/${unknown}/tree`).expect(200);
    expect(empty.body).toEqual({ nodes: [] });

    const external = await request(app).get('/skills/registry-skill/tree').expect(200);
    expect(external.body).toEqual({ nodes: [] });
  });

  it('rejects folder creation and reserved names', async () => {
    const folder = await request(app)
      .post(`/skills/${skillId}/tree`)
      .send({ type: 'folder', name: 'scripts' })
      .expect(400);
    expect(folder.body.error).toMatch(/Folders are derived/);

    const reserved = await request(app)
      .post(`/skills/${skillId}/tree`)
      .send({ type: 'file', name: 'SKILL.md', content: 'x' })
      .expect(400);
    expect(reserved.body.error).toMatch(/reserved/);
  });

  it('rejects creating a node whose parent is a file', async () => {
    await request(app)
      .post(`/skills/${skillId}/tree`)
      .send({ type: 'file', name: 'pkg.json', content: '{}' })
      .expect(201);

    const conflict = await request(app)
      .post(`/skills/${skillId}/tree`)
      .send({ type: 'file', name: 'nested.md', parentId: 'pkg.json', content: 'x' })
      .expect(400);
    expect(conflict.body.error).toMatch(/is a file, not a folder/);
  });

  it('conflicts when a node already exists at the path', async () => {
    await request(app)
      .post(`/skills/${skillId}/tree`)
      .send({ type: 'file', name: 'notes.md', content: 'a' })
      .expect(201);
    const conflict = await request(app)
      .post(`/skills/${skillId}/tree`)
      .send({ type: 'file', name: 'notes.md', content: 'b' })
      .expect(409);
    expect(conflict.body.error).toMatch(/already exists/);
  });

  it('rejects binary payloads so they go through the files route', async () => {
    const binary = await request(app)
      .post(`/skills/${skillId}/tree`)
      .send({ type: 'file', name: 'blob.bin', content: 'a\u0000b' })
      .expect(415);
    expect(binary.body.error).toMatch(/Binary files/);
  });

  it('renames a node and refuses to touch SKILL.md', async () => {
    await request(app)
      .post(`/skills/${skillId}/tree`)
      .send({ type: 'file', name: 'old.md', content: 'x' })
      .expect(201);

    const renamed = await request(app)
      .patch(`/skills/${skillId}/tree/${encodeURIComponent('old.md')}`)
      .send({ name: 'new.md' })
      .expect(200);
    expect(renamed.body).toMatchObject({ _id: 'new.md', name: 'new.md' });

    const after = await request(app).get(`/skills/${skillId}/tree`).expect(200);
    const ids = after.body.nodes.map((node: { _id: string }) => node._id);
    expect(ids).toContain('new.md');
    expect(ids).not.toContain('old.md');

    const blocked = await request(app)
      .patch(`/skills/${skillId}/tree/${encodeURIComponent('SKILL.md')}`)
      .send({ name: 'README.md' })
      .expect(400);
    expect(blocked.body.error).toMatch(/SKILL\.md cannot be renamed/);
  });

  it('deletes a node and refuses to delete SKILL.md', async () => {
    await request(app)
      .post(`/skills/${skillId}/tree`)
      .send({ type: 'file', name: 'drop.md', content: 'x' })
      .expect(201);

    const deleted = await request(app)
      .delete(`/skills/${skillId}/tree/${encodeURIComponent('drop.md')}`)
      .expect(200);
    expect(deleted.body).toMatchObject({ deleted: true, removed: 1 });

    const after = await request(app).get(`/skills/${skillId}/tree`).expect(200);
    const ids = after.body.nodes.map((node: { _id: string }) => node._id);
    expect(ids).not.toContain('drop.md');

    const blocked = await request(app)
      .delete(`/skills/${skillId}/tree/${encodeURIComponent('SKILL.md')}`)
      .expect(400);
    expect(blocked.body.error).toMatch(/cannot be deleted/);
  });

  it('reads and writes node content, using the body for SKILL.md', async () => {
    await request(app)
      .post(`/skills/${skillId}/tree`)
      .send({ type: 'file', name: 'doc.md', content: 'first' })
      .expect(201);

    const read = await request(app)
      .get(`/skills/${skillId}/tree/${encodeURIComponent('doc.md')}/content`)
      .expect(200);
    expect(read.body).toMatchObject({ content: 'first', mimeType: 'text/plain' });

    await request(app)
      .put(`/skills/${skillId}/tree/${encodeURIComponent('doc.md')}/content`)
      .send({ content: 'second' })
      .expect(200);
    const reread = await request(app)
      .get(`/skills/${skillId}/tree/${encodeURIComponent('doc.md')}/content`)
      .expect(200);
    expect(reread.body.content).toBe('second');

    const body = await request(app)
      .get(`/skills/${skillId}/tree/${encodeURIComponent('SKILL.md')}/content`)
      .expect(200);
    expect(body.body).toMatchObject({ content: '# Body\n\nInstructions', mimeType: 'text/markdown' });
  });

  it('refuses to edit SKILL.md content through the tree route', async () => {
    const blocked = await request(app)
      .put(`/skills/${skillId}/tree/${encodeURIComponent('SKILL.md')}/content`)
      .send({ content: 'nope' })
      .expect(400);
    expect(blocked.body.error).toMatch(/PATCH \/api\/skills/);
  });

  it('reports 404 for content of an unknown node', async () => {
    await request(app)
      .get(`/skills/${skillId}/tree/${encodeURIComponent('missing.md')}/content`)
      .expect(404);
  });
});
