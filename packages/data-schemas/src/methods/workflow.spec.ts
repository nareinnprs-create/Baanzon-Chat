import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IWorkflow, IWorkflowRun } from '..';
import { createWorkflowMethods, slugifyWorkflowName } from './workflow';
import { tenantStorage } from '../config/tenantContext';
import { createModels } from '../models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

const TENANT_A = 'tenant-aaaaaaaaaaaaaaaaaaaa';
const TENANT_B = 'tenant-bbbbbbbbbbbbbbbbbbbb';

let mongoServer: MongoMemoryServer;
let Workflow: mongoose.Model<IWorkflow>;
let WorkflowRun: mongoose.Model<IWorkflowRun>;
let methods: ReturnType<typeof createWorkflowMethods>;

const user = new mongoose.Types.ObjectId().toString();
const _otherUser = new mongoose.Types.ObjectId().toString();

function runAs<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ tenantId }, fn);
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  Workflow = mongoose.models.Workflow as mongoose.Model<IWorkflow>;
  WorkflowRun = mongoose.models.WorkflowRun as mongoose.Model<IWorkflowRun>;
  methods = createWorkflowMethods(mongoose);
  await Workflow.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([Workflow.deleteMany({}), WorkflowRun.deleteMany({})]);
});

describe('slugifyWorkflowName', () => {
  it('lowercases, dashes and trims a human name', () => {
    expect(slugifyWorkflowName('  Daily Digest!!  ')).toBe('daily-digest');
  });

  it('returns an empty string when nothing usable remains', () => {
    expect(slugifyWorkflowName('!!!')).toBe('');
  });
});

describe('createWorkflow', () => {
  it('derives a slug from the name and enables the workflow', async () => {
    const workflow = await methods.createWorkflow({ name: 'Nightly Sync', createdBy: user });

    expect(workflow).toMatchObject({ name: 'Nightly Sync', slug: 'nightly-sync', enabled: true });
    expect(workflow.createdBy.toString()).toBe(user);
  });

  it('slugifies an explicit slug and falls back for unusable names', async () => {
    const explicit = await methods.createWorkflow({
      name: 'X',
      slug: 'My Custom Slug',
      createdBy: user,
    });
    expect(explicit.slug).toBe('my-custom-slug');

    const fallback = await methods.createWorkflow({ name: '!!!', createdBy: user });
    expect(fallback.slug).toBe('workflow');
  });

  it('rejects a blank name and an invalid owner', async () => {
    await expect(methods.createWorkflow({ name: '  ', createdBy: user })).rejects.toThrow(
      /name is required/i,
    );
    await expect(methods.createWorkflow({ name: 'Ok', createdBy: 'bad' })).rejects.toThrow(
      /createdBy is required/i,
    );
  });

  it('enforces a unique slug within a tenant but allows it across tenants', async () => {
    await runAs(TENANT_A, () => methods.createWorkflow({ name: 'Alpha', createdBy: user }));
    await expect(
      runAs(TENANT_A, () => methods.createWorkflow({ name: 'Alpha', createdBy: user })),
    ).rejects.toThrow();

    const b = await runAs(TENANT_B, () =>
      methods.createWorkflow({ name: 'Alpha', createdBy: user }),
    );
    expect(b.slug).toBe('alpha');
  });
});

describe('getWorkflow / getWorkflowBySlug / listWorkflows / updateWorkflow', () => {
  it('reads by id and slug, filters by availability and updates', async () => {
    const workflow = await methods.createWorkflow({
      name: 'Alpha',
      createdBy: user,
      enabled: false,
    });
    const id = workflow._id!.toString();
    await methods.createWorkflow({ name: 'Beta', createdBy: user });

    expect((await methods.getWorkflow(id))?.name).toBe('Alpha');
    expect(await methods.getWorkflow('bad')).toBeNull();
    expect((await methods.getWorkflowBySlug('alpha'))?.name).toBe('Alpha');
    expect(await methods.getWorkflowBySlug('  ')).toBeNull();

    expect((await methods.listWorkflows({ enabledOnly: true })).map((w) => w.name)).toEqual([
      'Beta',
    ]);
    expect(await methods.listWorkflows()).toHaveLength(2);

    const updated = await methods.updateWorkflow(id, {
      name: 'Alpha 2',
      definition: { steps: [] },
      enabled: true,
    });
    expect(updated).toMatchObject({ name: 'Alpha 2', definition: { steps: [] }, enabled: true });

    await expect(methods.updateWorkflow(id, { name: '  ' })).rejects.toThrow(/name is required/i);
    expect(await methods.updateWorkflow('bad', { enabled: false })).toBeNull();
  });
});

describe('deleteWorkflow', () => {
  it('removes the workflow and cascades to its runs', async () => {
    const workflow = await methods.createWorkflow({ name: 'Alpha', createdBy: user });
    await new WorkflowRun({ runId: 'run-1', workflowId: workflow._id, user }).save();

    expect(await methods.deleteWorkflow(workflow._id!.toString())).toBe(true);
    expect(await Workflow.countDocuments({})).toBe(0);
    expect(await WorkflowRun.countDocuments({})).toBe(0);

    expect(await methods.deleteWorkflow(new mongoose.Types.ObjectId().toString())).toBe(false);
    expect(await methods.deleteWorkflow('bad')).toBe(false);
  });
});

describe('tenant isolation', () => {
  it('keeps workflows invisible across tenants', async () => {
    await runAs(TENANT_A, () => methods.createWorkflow({ name: 'Alpha', createdBy: user }));

    expect(await runAs(TENANT_B, () => methods.listWorkflows())).toEqual([]);
    expect(await runAs(TENANT_B, () => methods.getWorkflowBySlug('alpha'))).toBeNull();
  });
});
