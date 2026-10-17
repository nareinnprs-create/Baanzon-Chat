import type { Response } from 'express';
import type { UsageRecordDataSource, UsageRecordRow } from './types';
import type { ServerRequest } from '~/types';
import { createUsageRecordsHandlers } from './handlers';

interface MockResponse {
  res: Response;
  statusCode: number;
  body?: Record<string, unknown>;
}

function mockResponse(): MockResponse {
  let statusCode = 200;
  let body: Record<string, unknown> | undefined;
  const response: MockResponse = {
    statusCode,
    body,
    res: undefined as unknown as Response,
  };
  const res = {
    status(code: number) {
      statusCode = code;
      response.statusCode = code;
      return res;
    },
    json(value: Record<string, unknown>) {
      body = value;
      response.body = value;
      return res;
    },
  };
  response.res = res as unknown as Response;
  return response;
}

function request(overrides: Record<string, unknown> = {}): ServerRequest {
  return {
    user: { id: 'user-1', _id: 'user-1', tenantId: 'tenant-a' },
    query: {},
    params: {},
    body: {},
    ...overrides,
  } as unknown as ServerRequest;
}

function dataSource(): jest.Mocked<UsageRecordDataSource> {
  return {
    createUsageRecord: jest.fn(),
    getUsageRecord: jest.fn(),
    listUsageRecords: jest.fn(),
    updateUsageRecord: jest.fn(),
    deleteUsageRecord: jest.fn(),
  } as unknown as jest.Mocked<UsageRecordDataSource>;
}

const RECORD_ID = '507f1f77bcf86cd799439011';
const RECORDED_AT = new Date('2024-01-01T00:00:00.000Z');

function record(overrides: Partial<UsageRecordRow> = {}): UsageRecordRow {
  return {
    _id: RECORD_ID,
    scope: 'user',
    userId: 'user-1',
    key: 'tokens',
    value: 100,
    recordedAt: RECORDED_AT,
    ...overrides,
  };
}

describe('createUsageRecordsHandlers', () => {
  it('returns 401 for every route without an authenticated user', async () => {
    const local = createUsageRecordsHandlers(dataSource());
    const unauthenticated = request({ user: undefined });

    const list = mockResponse();
    await local.list(unauthenticated, list.res);
    expect(list.statusCode).toBe(401);

    const get = mockResponse();
    await local.get(unauthenticated, get.res);
    expect(get.statusCode).toBe(401);

    const create = mockResponse();
    await local.create(unauthenticated, create.res);
    expect(create.statusCode).toBe(401);

    const update = mockResponse();
    await local.update(unauthenticated, update.res);
    expect(update.statusCode).toBe(401);

    const remove = mockResponse();
    await local.delete(unauthenticated, remove.res);
    expect(remove.statusCode).toBe(401);
  });

  it('lists only the authenticated user records with filters applied', async () => {
    const listUsageRecords = jest.fn().mockResolvedValue([record()]);
    const local = createUsageRecordsHandlers({ ...dataSource(), listUsageRecords });
    const response = mockResponse();

    await local.list(
      request({ query: { scope: 'user', key: 'tokens', from: '2024-01-01', to: '2024-01-31' } }),
      response.res,
    );

    expect(listUsageRecords).toHaveBeenCalledWith({
      scope: 'user',
      userId: 'user-1',
      key: 'tokens',
      from: new Date('2024-01-01'),
      to: new Date('2024-01-31'),
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      usageRecords: [
        {
          id: RECORD_ID,
          scope: 'user',
          userId: 'user-1',
          key: 'tokens',
          value: 100,
          recordedAt: RECORDED_AT.toISOString(),
        },
      ],
    });
  });

  it('rejects a scope filter other than user', async () => {
    const listUsageRecords = jest.fn();
    const local = createUsageRecordsHandlers({ ...dataSource(), listUsageRecords });
    const response = mockResponse();

    await local.list(request({ query: { scope: 'organization' } }), response.res);

    expect(response.statusCode).toBe(400);
    expect(listUsageRecords).not.toHaveBeenCalled();
  });

  it('rejects an invalid from date', async () => {
    const listUsageRecords = jest.fn();
    const local = createUsageRecordsHandlers({ ...dataSource(), listUsageRecords });
    const response = mockResponse();

    await local.list(request({ query: { from: 'not-a-date' } }), response.res);

    expect(response.statusCode).toBe(400);
    expect(listUsageRecords).not.toHaveBeenCalled();
  });

  it('returns 404 for a record owned by another user', async () => {
    const getUsageRecord = jest.fn().mockResolvedValue(record({ userId: 'user-2' }));
    const local = createUsageRecordsHandlers({ ...dataSource(), getUsageRecord });
    const response = mockResponse();

    await local.get(request({ params: { id: RECORD_ID } }), response.res);

    expect(response.statusCode).toBe(404);
  });

  it('hides a record belonging to another tenant', async () => {
    const getUsageRecord = jest.fn().mockResolvedValue(record({ tenantId: 'tenant-b' }));
    const local = createUsageRecordsHandlers({ ...dataSource(), getUsageRecord });
    const response = mockResponse();

    await local.get(request({ params: { id: RECORD_ID } }), response.res);

    expect(response.statusCode).toBe(404);
  });

  it('returns a record to its owner', async () => {
    const getUsageRecord = jest.fn().mockResolvedValue(record());
    const local = createUsageRecordsHandlers({ ...dataSource(), getUsageRecord });
    const response = mockResponse();

    await local.get(request({ params: { id: RECORD_ID } }), response.res);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      id: RECORD_ID,
      scope: 'user',
      userId: 'user-1',
      key: 'tokens',
      value: 100,
      recordedAt: RECORDED_AT.toISOString(),
    });
  });

  it('rejects a malformed record id', async () => {
    const getUsageRecord = jest.fn();
    const local = createUsageRecordsHandlers({ ...dataSource(), getUsageRecord });
    const response = mockResponse();

    await local.get(request({ params: { id: 'not-an-id' } }), response.res);

    expect(response.statusCode).toBe(400);
    expect(getUsageRecord).not.toHaveBeenCalled();
  });

  it('always attributes a new record to the authenticated user with the user scope', async () => {
    const createUsageRecord = jest.fn().mockResolvedValue(record());
    const local = createUsageRecordsHandlers({ ...dataSource(), createUsageRecord });
    const response = mockResponse();

    await local.create(
      request({ body: { scope: 'user', key: 'tokens', value: 5, userId: 'attacker' } }),
      response.res,
    );

    expect(createUsageRecord).toHaveBeenCalledWith({
      scope: 'user',
      userId: 'user-1',
      key: 'tokens',
      value: 5,
    });
    expect(response.statusCode).toBe(201);
  });

  it('rejects a create with a non-user scope', async () => {
    const createUsageRecord = jest.fn();
    const local = createUsageRecordsHandlers({ ...dataSource(), createUsageRecord });
    const response = mockResponse();

    await local.create(
      request({ body: { scope: 'organization', key: 'tokens', value: 5 } }),
      response.res,
    );

    expect(response.statusCode).toBe(400);
    expect(createUsageRecord).not.toHaveBeenCalled();
  });

  it('rejects an invalid record payload without writing', async () => {
    const createUsageRecord = jest.fn();
    const local = createUsageRecordsHandlers({ ...dataSource(), createUsageRecord });
    const response = mockResponse();

    await local.create(request({ body: { value: 1 } }), response.res);

    expect(response.statusCode).toBe(400);
    expect(createUsageRecord).not.toHaveBeenCalled();
  });

  it('updates an owned record with the validated patch only', async () => {
    const getUsageRecord = jest.fn().mockResolvedValue(record());
    const updateUsageRecord = jest.fn().mockResolvedValue(record({ value: 250, unit: 'tokens' }));
    const local = createUsageRecordsHandlers({
      ...dataSource(),
      getUsageRecord,
      updateUsageRecord,
    });
    const response = mockResponse();

    await local.update(
      request({
        params: { id: RECORD_ID },
        body: { value: 250, unit: 'tokens', userId: 'attacker' },
      }),
      response.res,
    );

    expect(updateUsageRecord).toHaveBeenCalledWith(RECORD_ID, { value: 250, unit: 'tokens' });
    expect(response.statusCode).toBe(200);
  });

  it('rejects an empty update patch', async () => {
    const updateUsageRecord = jest.fn();
    const local = createUsageRecordsHandlers({ ...dataSource(), updateUsageRecord });
    const response = mockResponse();

    await local.update(request({ params: { id: RECORD_ID }, body: {} }), response.res);

    expect(response.statusCode).toBe(400);
    expect(updateUsageRecord).not.toHaveBeenCalled();
  });

  it('refuses to update a record owned by another user', async () => {
    const getUsageRecord = jest.fn().mockResolvedValue(record({ userId: 'user-2' }));
    const updateUsageRecord = jest.fn();
    const local = createUsageRecordsHandlers({
      ...dataSource(),
      getUsageRecord,
      updateUsageRecord,
    });
    const response = mockResponse();

    await local.update(request({ params: { id: RECORD_ID }, body: { value: 300 } }), response.res);

    expect(response.statusCode).toBe(404);
    expect(updateUsageRecord).not.toHaveBeenCalled();
  });

  it('deletes an owned record', async () => {
    const getUsageRecord = jest.fn().mockResolvedValue(record());
    const deleteUsageRecord = jest.fn().mockResolvedValue(true);
    const local = createUsageRecordsHandlers({
      ...dataSource(),
      getUsageRecord,
      deleteUsageRecord,
    });
    const response = mockResponse();

    await local.delete(request({ params: { id: RECORD_ID } }), response.res);

    expect(deleteUsageRecord).toHaveBeenCalledWith(RECORD_ID);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ deleted: true });
  });

  it('refuses to delete a record owned by another user', async () => {
    const getUsageRecord = jest.fn().mockResolvedValue(record({ userId: 'user-2' }));
    const deleteUsageRecord = jest.fn();
    const local = createUsageRecordsHandlers({
      ...dataSource(),
      getUsageRecord,
      deleteUsageRecord,
    });
    const response = mockResponse();

    await local.delete(request({ params: { id: RECORD_ID } }), response.res);

    expect(response.statusCode).toBe(404);
    expect(deleteUsageRecord).not.toHaveBeenCalled();
  });

  it('surfaces a storage failure as a 500', async () => {
    const listUsageRecords = jest.fn().mockRejectedValue(new Error('boom'));
    const local = createUsageRecordsHandlers({ ...dataSource(), listUsageRecords });
    const response = mockResponse();

    await local.list(request(), response.res);

    expect(response.statusCode).toBe(500);
  });
});
