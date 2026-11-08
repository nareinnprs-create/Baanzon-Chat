import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IChatProject, IConversation } from '~/types';
import { tenantStorage } from '~/config/tenantContext';
import {
  createChatProjectMethods,
  updateChatProjectLastConversationForUser,
  type ChatProjectMethods,
} from './chatProject';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let ChatProject: mongoose.Model<IChatProject>;
let Conversation: mongoose.Model<IConversation>;
let methods: ChatProjectMethods;
let modelsToCleanup: string[] = [];

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();

  const models = createModels(mongoose);
  modelsToCleanup = Object.keys(models);
  Object.assign(mongoose.models, models);

  ChatProject = mongoose.models.ChatProject as mongoose.Model<IChatProject>;
  Conversation = mongoose.models.Conversation as mongoose.Model<IConversation>;
  methods = createChatProjectMethods(mongoose);

  await mongoose.connect(mongoUri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();

  for (const modelName of modelsToCleanup) {
    if (mongoose.models[modelName]) {
      delete mongoose.models[modelName];
    }
  }
});

afterEach(async () => {
  await ChatProject.deleteMany({});
  await Conversation.deleteMany({});
});

async function createConversation(user: string, conversationId: string, title: string) {
  return await Conversation.create({
    conversationId,
    title,
    user,
    endpoint: 'openAI',
  });
}

describe('ChatProject methods', () => {
  const user = 'user-1';
  const otherUser = 'user-2';

  it('creates, reads, updates, and lists private projects', async () => {
    const project = await methods.createChatProject(user, {
      name: 'Customer Alpha',
      description: 'Support work',
    });

    expect(project.name).toBe('Customer Alpha');
    expect(project.conversationCount).toBe(0);

    const readProject = await methods.getChatProject(user, project._id!.toString());
    expect(readProject?.description).toBe('Support work');

    const updatedProject = await methods.updateChatProject(user, project._id!.toString(), {
      name: 'Customer Alpha Updated',
    });
    expect(updatedProject?.name).toBe('Customer Alpha Updated');

    const list = await methods.listChatProjects(user, { sortBy: 'name', sortDirection: 'asc' });
    expect(list.projects).toHaveLength(1);
    expect(list.projects[0].name).toBe('Customer Alpha Updated');
  });

  it('filters projects by name or description search', async () => {
    await methods.createChatProject(user, {
      name: 'Customer Alpha',
      description: 'Support work',
    });
    await methods.createChatProject(user, {
      name: 'Internal Tools',
      description: 'Overflow menu test',
    });

    const byName = await methods.listChatProjects(user, { search: 'alpha' });
    expect(byName.projects.map((project) => project.name)).toEqual(['Customer Alpha']);

    const byDescription = await methods.listChatProjects(user, { search: 'overflow' });
    expect(byDescription.projects.map((project) => project.name)).toEqual(['Internal Tools']);

    const noMatch = await methods.listChatProjects(user, { search: 'zzzz' });
    expect(noMatch.projects).toHaveLength(0);
  });

  it('paginates projects deterministically when latest activity is null', async () => {
    const staleProject = await methods.createChatProject(user, { name: 'Stale' });
    await methods.createChatProject(user, { name: 'Quiet A' });
    await methods.createChatProject(user, { name: 'Quiet B' });
    const recentProject = await methods.createChatProject(user, { name: 'Recent' });

    await ChatProject.updateOne(
      { _id: staleProject._id },
      { $set: { lastConversationAt: new Date('2026-01-01T00:00:00.000Z') } },
    );
    await ChatProject.updateOne(
      { _id: recentProject._id },
      { $set: { lastConversationAt: new Date('2026-02-01T00:00:00.000Z') } },
    );

    const firstPage = await methods.listChatProjects(user, {
      sortBy: 'lastConversationAt',
      sortDirection: 'desc',
      limit: 3,
    });
    const secondPage = await methods.listChatProjects(user, {
      sortBy: 'lastConversationAt',
      sortDirection: 'desc',
      limit: 3,
      cursor: firstPage.nextCursor,
    });
    const names = [...firstPage.projects, ...secondPage.projects].map((project) => project.name);

    expect(firstPage.projects[0].name).toBe('Recent');
    expect(firstPage.projects[1].name).toBe('Stale');
    expect(firstPage.nextCursor).toBeTruthy();
    expect(secondPage.projects.every((project) => project.lastConversationAt == null)).toBe(true);
    expect(names).toEqual(expect.arrayContaining(['Recent', 'Stale', 'Quiet A', 'Quiet B']));
    expect(new Set(names).size).toBe(4);

    const invalidCursor = Buffer.from(
      JSON.stringify({ primary: 'not-a-date', id: recentProject._id!.toString() }),
    ).toString('base64');
    const invalidCursorPage = await methods.listChatProjects(user, {
      sortBy: 'lastConversationAt',
      sortDirection: 'desc',
      limit: 1,
      cursor: invalidCursor,
    });

    expect(invalidCursorPage.projects[0].name).toBe('Recent');
  });

  it('paginates chat-less projects when a page ends on the last dated project', async () => {
    const staleProject = await methods.createChatProject(user, { name: 'Stale' });
    await methods.createChatProject(user, { name: 'Quiet A' });
    await methods.createChatProject(user, { name: 'Quiet B' });
    const recentProject = await methods.createChatProject(user, { name: 'Recent' });

    await ChatProject.updateOne(
      { _id: staleProject._id },
      { $set: { lastConversationAt: new Date('2026-01-01T00:00:00.000Z') } },
    );
    await ChatProject.updateOne(
      { _id: recentProject._id },
      { $set: { lastConversationAt: new Date('2026-02-01T00:00:00.000Z') } },
    );

    // limit equals the number of dated projects, so the cursor lands on a dated
    // project; the null (chat-less) projects must still appear on the next page.
    const firstPage = await methods.listChatProjects(user, {
      sortBy: 'lastConversationAt',
      sortDirection: 'desc',
      limit: 2,
    });
    const secondPage = await methods.listChatProjects(user, {
      sortBy: 'lastConversationAt',
      sortDirection: 'desc',
      limit: 2,
      cursor: firstPage.nextCursor,
    });

    expect(firstPage.projects.map((project) => project.name)).toEqual(['Recent', 'Stale']);
    expect(firstPage.nextCursor).toBeTruthy();
    expect(secondPage.projects.map((project) => project.name).sort()).toEqual([
      'Quiet A',
      'Quiet B',
    ]);
    expect(secondPage.projects.every((project) => project.lastConversationAt == null)).toBe(true);
  });

  it('assigns many conversations to one project and updates stats', async () => {
    const project = await methods.createChatProject(user, { name: 'Customer Alpha' });
    await createConversation(user, 'convo-1', 'First');
    await createConversation(user, 'convo-2', 'Second');

    await methods.assignConversationToProject(user, 'convo-1', project._id!.toString());
    await methods.assignConversationToProject(user, 'convo-2', project._id!.toString());

    const conversations = await Conversation.find({
      user,
      chatProjectId: project._id!.toString(),
    }).lean<IConversation[]>();
    const refreshedProject = await methods.getChatProject(user, project._id!.toString());

    expect(conversations).toHaveLength(2);
    expect(refreshedProject?.conversationCount).toBe(2);
    expect(refreshedProject?.lastConversationId).toBeDefined();
  });

  it('excludes retention-hidden conversations from project stats', async () => {
    const project = await methods.createChatProject(user, { name: 'Visible Stats' });
    const chatProjectId = project._id!.toString();
    const visibleDate = new Date('2026-01-01T00:00:00.000Z');
    const hiddenDate = new Date('2026-02-01T00:00:00.000Z');

    await Conversation.collection.insertMany([
      {
        conversationId: 'visible-convo',
        title: 'Visible',
        user,
        endpoint: 'openAI',
        chatProjectId,
        isTemporary: false,
        expiredAt: null,
        createdAt: visibleDate,
        updatedAt: visibleDate,
      },
      {
        conversationId: 'temporary-convo',
        title: 'Temporary',
        user,
        endpoint: 'openAI',
        chatProjectId,
        isTemporary: true,
        expiredAt: new Date('2027-03-01T00:00:00.000Z'),
        createdAt: hiddenDate,
        updatedAt: hiddenDate,
      },
      {
        conversationId: 'expired-convo',
        title: 'Expired',
        user,
        endpoint: 'openAI',
        chatProjectId,
        isTemporary: false,
        expiredAt: new Date('2025-12-01T00:00:00.000Z'),
        createdAt: hiddenDate,
        updatedAt: hiddenDate,
      },
    ]);

    const refreshedProject = await methods.refreshChatProjectStats(user, chatProjectId);

    expect(refreshedProject?.conversationCount).toBe(1);
    expect(refreshedProject?.lastConversationId).toBe('visible-convo');
    expect(refreshedProject?.lastConversationAt?.toISOString()).toBe(visibleDate.toISOString());
  });

  it('retries instead of overwriting a newer concurrent stats update', async () => {
    const project = await methods.createChatProject(user, { name: 'Concurrent Stats' });
    const chatProjectId = project._id!.toString();
    const initialDate = new Date('2026-01-01T00:00:00.000Z');
    const newerDate = new Date('2026-02-01T00:00:00.000Z');

    await Conversation.collection.insertOne({
      conversationId: 'initial-convo',
      title: 'Initial',
      user,
      endpoint: 'openAI',
      chatProjectId,
      createdAt: initialDate,
      updatedAt: initialDate,
    });
    await ChatProject.findByIdAndUpdate(project._id, {
      conversationCount: 1,
      lastConversationAt: initialDate,
      lastConversationId: 'initial-convo',
    });

    const findOneAndUpdate = ChatProject.findOneAndUpdate.bind(ChatProject);
    const updateSpy = jest
      .spyOn(ChatProject, 'findOneAndUpdate')
      .mockImplementationOnce((filter, update, options) => {
        const query = findOneAndUpdate(filter, update, options);
        const exec = query.exec.bind(query);
        jest.spyOn(query, 'exec').mockImplementationOnce(async () => {
          await Conversation.collection.insertOne({
            conversationId: 'newer-convo',
            title: 'Newer',
            user,
            endpoint: 'openAI',
            chatProjectId,
            createdAt: newerDate,
            updatedAt: newerDate,
          });
          await ChatProject.updateOne(
            { _id: project._id },
            {
              conversationCount: 2,
              lastConversationAt: newerDate,
              lastConversationId: 'newer-convo',
            },
          );
          return await exec();
        });
        return query;
      });

    try {
      const refreshed = await methods.refreshChatProjectStats(user, chatProjectId);

      expect(refreshed?.conversationCount).toBe(2);
      expect(refreshed?.lastConversationId).toBe('newer-convo');
      expect(refreshed?.lastConversationAt?.toISOString()).toBe(newerDate.toISOString());
      expect(updateSpy).toHaveBeenCalledTimes(2);
    } finally {
      updateSpy.mockRestore();
    }

    const persisted = await ChatProject.findById(project._id).lean<IChatProject>();
    expect(persisted?.conversationCount).toBe(2);
    expect(persisted?.lastConversationId).toBe('newer-convo');
    expect(persisted?.lastConversationAt?.toISOString()).toBe(newerDate.toISOString());
  });

  it('keeps reconciling after the first three optimistic attempts lose the race', async () => {
    const project = await methods.createChatProject(user, { name: 'Exhausted Then Succeeds' });
    const chatProjectId = project._id!.toString();
    await ChatProject.findByIdAndUpdate(project._id, {
      conversationCount: 4,
      lastConversationId: 'stale-convo',
    });

    let casAttempts = 0;
    const findOneAndUpdate = ChatProject.findOneAndUpdate.bind(ChatProject);
    const updateSpy = jest
      .spyOn(ChatProject, 'findOneAndUpdate')
      .mockImplementation((filter, update, options) => {
        const query = findOneAndUpdate(filter, update, options);
        const exec = query.exec.bind(query);
        jest.spyOn(query, 'exec').mockImplementation(async () => {
          casAttempts += 1;
          if (casAttempts <= 3) {
            await ChatProject.updateOne(
              { _id: project._id },
              {
                lastConversationAt: new Date(`2026-03-0${casAttempts}T00:00:00.000Z`),
                lastConversationId: `concurrent-${casAttempts}`,
              },
            );
          }
          return await exec();
        });
        return query;
      });

    try {
      const refreshed = await methods.refreshChatProjectStats(user, chatProjectId);
      expect(refreshed?.conversationCount).toBe(0);
      expect(refreshed?.lastConversationId).toBeNull();
      expect(casAttempts).toBeGreaterThan(3);
    } finally {
      updateSpy.mockRestore();
    }

    const persisted = await ChatProject.findById(project._id).lean<IChatProject>();
    expect(persisted?.conversationCount).toBe(0);
    expect(persisted?.lastConversationId).toBeNull();
  });

  it('throws instead of returning stale stats when every optimistic write loses', async () => {
    const project = await methods.createChatProject(user, { name: 'Never Settles' });
    const chatProjectId = project._id!.toString();
    await ChatProject.findByIdAndUpdate(project._id, {
      conversationCount: 4,
      lastConversationId: 'stale-convo',
    });

    const updateSpy = jest.spyOn(ChatProject, 'findOneAndUpdate').mockImplementation(
      () =>
        ({
          lean: async () => null,
        }) as unknown as ReturnType<typeof ChatProject.findOneAndUpdate>,
    );

    try {
      await expect(methods.refreshChatProjectStats(user, chatProjectId)).rejects.toThrow(
        /refresh chat project stats/i,
      );
    } finally {
      updateSpy.mockRestore();
    }

    const persisted = await ChatProject.findById(project._id).lean<IChatProject>();
    expect(persisted?.conversationCount).toBe(4);
    expect(persisted?.lastConversationId).toBe('stale-convo');
  });

  it('does not increment again when a refresh already counted the new conversation', async () => {
    const project = await methods.createChatProject(user, { name: 'Pending Increment' });
    const chatProjectId = project._id!.toString();
    const createdAt = new Date('2026-04-01T00:00:00.000Z');
    await Conversation.create({
      conversationId: 'new-convo',
      title: 'New',
      user,
      endpoint: 'openAI',
      chatProjectId,
      createdAt,
      updatedAt: createdAt,
    });

    const refreshed = await methods.refreshChatProjectStats(user, chatProjectId);
    expect(refreshed?.conversationCount).toBe(1);
    expect(refreshed?.lastConversationId).toBe('new-convo');

    await updateChatProjectLastConversationForUser(
      mongoose,
      user,
      chatProjectId,
      {
        conversationId: 'new-convo',
        createdAt,
        updatedAt: createdAt,
      },
      true,
    );

    const persisted = await ChatProject.findById(project._id).lean<IChatProject>();
    expect(persisted?.conversationCount).toBe(1);
    expect(persisted?.lastConversationId).toBe('new-convo');
  });

  it('enforces one project per chat when moving conversations', async () => {
    const firstProject = await methods.createChatProject(user, { name: 'First' });
    const secondProject = await methods.createChatProject(user, { name: 'Second' });
    await createConversation(user, 'convo-1', 'First');

    await methods.assignConversationToProject(user, 'convo-1', firstProject._id!.toString());
    await methods.assignConversationToProject(user, 'convo-1', secondProject._id!.toString());

    const movedConversation = await Conversation.findOne({
      user,
      conversationId: 'convo-1',
    }).lean<IConversation>();
    const refreshedFirst = await methods.getChatProject(user, firstProject._id!.toString());
    const refreshedSecond = await methods.getChatProject(user, secondProject._id!.toString());

    expect(movedConversation?.chatProjectId).toBe(secondProject._id!.toString());
    expect(refreshedFirst?.conversationCount).toBe(0);
    expect(refreshedSecond?.conversationCount).toBe(1);
  });

  it('deleting a project unassigns chats instead of deleting them', async () => {
    const project = await methods.createChatProject(user, { name: 'Delete me' });
    await createConversation(user, 'convo-1', 'First');
    await methods.assignConversationToProject(user, 'convo-1', project._id!.toString());

    const result = await methods.deleteChatProject(user, project._id!.toString());
    const conversation = await Conversation.findOne({
      user,
      conversationId: 'convo-1',
    }).lean<IConversation>();

    expect(result.deletedCount).toBe(1);
    expect(result.modifiedCount).toBe(1);
    expect(conversation).not.toBeNull();
    expect(conversation?.chatProjectId).toBeUndefined();
  });

  it('isolates projects and assignments by user', async () => {
    const project = await methods.createChatProject(user, { name: 'Mine' });
    await createConversation(otherUser, 'convo-1', 'Theirs');

    const otherRead = await methods.getChatProject(otherUser, project._id!.toString());
    const assignment = await methods.assignConversationToProject(
      user,
      'convo-1',
      project._id!.toString(),
    );
    const deleteResult = await methods.deleteChatProject(otherUser, project._id!.toString());

    expect(otherRead).toBeNull();
    expect(assignment).toBeNull();
    expect(deleteResult.deletedCount).toBe(0);
  });
});

describe('ChatProject workspace link', () => {
  const user = 'workspace-user-1';
  const teammate = 'workspace-user-2';
  let workspaceId: string;
  let otherWorkspaceId: string;

  beforeEach(() => {
    workspaceId = new mongoose.Types.ObjectId().toHexString();
    otherWorkspaceId = new mongoose.Types.ObjectId().toHexString();
  });

  it('creates projects with and without a workspace', async () => {
    const linked = await methods.createChatProject(user, { name: 'Linked', workspaceId });
    const personal = await methods.createChatProject(user, { name: 'Personal' });
    const explicitNull = await methods.createChatProject(user, {
      name: 'Explicitly none',
      workspaceId: null,
    });

    expect(linked.workspaceId).toBe(workspaceId);
    expect(personal.workspaceId).toBeUndefined();
    expect(explicitNull.workspaceId).toBeUndefined();

    const persisted = await ChatProject.findById(linked._id).lean<IChatProject>();
    expect(persisted?.workspaceId).toBe(workspaceId);
  });

  it('rejects a workspace id that is not an ObjectId', async () => {
    await expect(
      methods.createChatProject(user, { name: 'Bad', workspaceId: 'not-a-workspace' }),
    ).rejects.toThrow('A valid workspaceId is required');

    const stored = await ChatProject.countDocuments({ user });
    expect(stored).toBe(0);
  });

  it('scopes the user list to one workspace', async () => {
    await methods.createChatProject(user, { name: 'In Workspace', workspaceId });
    await methods.createChatProject(user, { name: 'Elsewhere', workspaceId: otherWorkspaceId });
    await methods.createChatProject(user, { name: 'Pre-workspace' });
    await methods.createChatProject(teammate, { name: 'Theirs', workspaceId });

    const scoped = await methods.listChatProjects(user, { workspaceId, sortBy: 'name' });
    const unscoped = await methods.listChatProjects(user, { sortBy: 'name' });
    const invalid = await methods.listChatProjects(user, { workspaceId: 'nope' });

    expect(scoped.projects.map((project) => project.name)).toEqual(['In Workspace']);
    expect(unscoped.projects.map((project) => project.name)).toEqual([
      'Pre-workspace',
      'In Workspace',
      'Elsewhere',
    ]);
    expect(invalid.projects).toHaveLength(0);
    expect(invalid.nextCursor).toBeNull();
  });

  it('composes workspace scoping with search, sort and cursor paging', async () => {
    await methods.createChatProject(user, { name: 'Alpha One', workspaceId });
    await methods.createChatProject(user, { name: 'Alpha Two', workspaceId });
    await methods.createChatProject(user, { name: 'Alpha Three', workspaceId });
    await methods.createChatProject(user, { name: 'Beta', workspaceId });
    await methods.createChatProject(user, { name: 'Alpha noise', workspaceId: otherWorkspaceId });

    const firstPage = await methods.listChatProjects(user, {
      workspaceId,
      search: 'alpha',
      sortBy: 'name',
      sortDirection: 'asc',
      limit: 2,
    });
    const secondPage = await methods.listChatProjects(user, {
      workspaceId,
      search: 'alpha',
      sortBy: 'name',
      sortDirection: 'asc',
      limit: 2,
      cursor: firstPage.nextCursor,
    });

    expect(firstPage.projects.map((project) => project.name)).toEqual(['Alpha One', 'Alpha Three']);
    expect(firstPage.nextCursor).toBeTruthy();
    expect(secondPage.projects.map((project) => project.name)).toEqual(['Alpha Two']);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('lists every member project in a workspace', async () => {
    await methods.createChatProject(user, { name: 'Mine', workspaceId });
    await methods.createChatProject(teammate, { name: 'Theirs', workspaceId });
    await methods.createChatProject(user, { name: 'Elsewhere', workspaceId: otherWorkspaceId });

    const listed = await methods.listWorkspaceChatProjects(workspaceId, { sortBy: 'name' });
    const invalid = await methods.listWorkspaceChatProjects('not-a-workspace');

    expect(listed.projects.map((project) => project.name).sort()).toEqual(['Mine', 'Theirs']);
    expect(listed.projects.every((project) => project.workspaceId === workspaceId)).toBe(true);
    expect(invalid.projects).toHaveLength(0);
  });

  it('moves a project into and out of a workspace on update', async () => {
    const project = await methods.createChatProject(user, { name: 'Movable' });

    const linked = await methods.updateChatProject(user, project._id!.toString(), { workspaceId });
    const renamed = await methods.updateChatProject(user, project._id!.toString(), {
      name: 'Movable, renamed',
    });
    const detached = await methods.updateChatProject(user, project._id!.toString(), {
      workspaceId: null,
    });

    expect(linked?.workspaceId).toBe(workspaceId);
    expect(renamed?.workspaceId).toBe(workspaceId);
    expect(detached?.workspaceId).toBeUndefined();

    const persisted = await ChatProject.findById(project._id).lean<IChatProject>();
    expect(persisted?.workspaceId).toBeUndefined();
    expect(persisted?.name).toBe('Movable, renamed');

    await expect(
      methods.updateChatProject(user, project._id!.toString(), { workspaceId: 'not-a-workspace' }),
    ).rejects.toThrow('A valid workspaceId is required');
  });

  it('composes workspace scoping with user and tenant scoping', async () => {
    const tenantA = 'tenant-workspace-a';
    const tenantB = 'tenant-workspace-b';

    await tenantStorage.run({ tenantId: tenantA }, () =>
      methods.createChatProject(user, { name: 'Tenant A project', workspaceId }),
    );

    const inTenantA = await tenantStorage.run({ tenantId: tenantA }, () =>
      methods.listChatProjects(user, { workspaceId }),
    );
    const tenantWideA = await tenantStorage.run({ tenantId: tenantA }, () =>
      methods.listWorkspaceChatProjects(workspaceId),
    );
    const inTenantB = await tenantStorage.run({ tenantId: tenantB }, () =>
      methods.listChatProjects(user, { workspaceId }),
    );
    const tenantWideB = await tenantStorage.run({ tenantId: tenantB }, () =>
      methods.listWorkspaceChatProjects(workspaceId),
    );

    expect(inTenantA.projects.map((project) => project.name)).toEqual(['Tenant A project']);
    expect(tenantWideA.projects.map((project) => project.name)).toEqual(['Tenant A project']);
    expect(inTenantB.projects).toHaveLength(0);
    expect(tenantWideB.projects).toHaveLength(0);

    const persisted = await ChatProject.findOne({ workspaceId }).lean<IChatProject>();
    expect(persisted?.tenantId).toBe(tenantA);
  });

  describe('searchChatProjectsByTitle', () => {
    it('returns bounded user-scoped hits for name and description matches', async () => {
      await methods.createChatProject(user, { name: 'Customer Alpha', description: 'Support work' });
      await methods.createChatProject(user, {
        name: 'Internal Tools',
        description: 'Overflow menu test',
      });
      await methods.createChatProject(teammate, { name: 'Customer Alpha clone' });

      const byName = await methods.searchChatProjectsByTitle(user, 'alpha');
      expect(byName.map((hit) => hit.name)).toEqual(['Customer Alpha']);
      expect(byName[0]?.id).toBeTruthy();

      const byDescription = await methods.searchChatProjectsByTitle(user, 'overflow');
      expect(byDescription.map((hit) => hit.name)).toEqual(['Internal Tools']);

      const noMatch = await methods.searchChatProjectsByTitle(user, 'zzzz');
      expect(noMatch).toEqual([]);
    });

    it('answers an empty query without hits and keeps an oversized limit bounded', async () => {
      await methods.createChatProject(user, { name: 'Alpha One' });
      await methods.createChatProject(user, { name: 'Alpha Two' });
      await methods.createChatProject(user, { name: 'Alpha Three' });

      expect(await methods.searchChatProjectsByTitle(user, '   ')).toEqual([]);

      const hits = await methods.searchChatProjectsByTitle(user, 'Alpha', 500);
      expect(hits.map((hit) => hit.name).sort()).toEqual(['Alpha One', 'Alpha Three', 'Alpha Two']);
    });
  });
});
