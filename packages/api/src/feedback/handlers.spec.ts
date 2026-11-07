import type { Response } from 'express';
import type { FeedbackDataSource, FeedbackRecord } from './types';
import type { ServerRequest } from '~/types';
import { createFeedbackHandlers } from './handlers';

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

function dataSource(): jest.Mocked<FeedbackDataSource> {
  return {
    createFeedback: jest.fn(),
    getFeedback: jest.fn(),
    listFeedback: jest.fn(),
    updateFeedback: jest.fn(),
    deleteFeedback: jest.fn(),
  } as unknown as jest.Mocked<FeedbackDataSource>;
}

const FEEDBACK_ID = '507f1f77bcf86cd799439011';
const SUBMITTED_AT = new Date('2024-01-01T00:00:00.000Z');

function record(overrides: Partial<FeedbackRecord> = {}): FeedbackRecord {
  return {
    _id: FEEDBACK_ID,
    userId: 'user-1',
    type: 'bug',
    subject: 'Bug',
    message: 'Something broke',
    submittedAt: SUBMITTED_AT,
    status: 'open',
    ...overrides,
  };
}

describe('createFeedbackHandlers', () => {
  it('returns 401 for every route without an authenticated user', async () => {
    const local = createFeedbackHandlers(dataSource());
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

  it('lists only the authenticated user feedback with filters applied', async () => {
    const listFeedback = jest.fn().mockResolvedValue([record()]);
    const local = createFeedbackHandlers({ ...dataSource(), listFeedback });
    const response = mockResponse();

    await local.list(request({ query: { type: 'bug', status: 'open' } }), response.res);

    expect(listFeedback).toHaveBeenCalledWith({ userId: 'user-1', type: 'bug', status: 'open' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      feedback: [
        {
          id: FEEDBACK_ID,
          userId: 'user-1',
          type: 'bug',
          subject: 'Bug',
          message: 'Something broke',
          submittedAt: SUBMITTED_AT.toISOString(),
          status: 'open',
        },
      ],
    });
  });

  it('rejects an invalid type filter', async () => {
    const listFeedback = jest.fn();
    const local = createFeedbackHandlers({ ...dataSource(), listFeedback });
    const response = mockResponse();

    await local.list(request({ query: { type: 'rant' } }), response.res);

    expect(response.statusCode).toBe(400);
    expect(listFeedback).not.toHaveBeenCalled();
  });

  it('returns 404 for feedback owned by another user', async () => {
    const getFeedback = jest.fn().mockResolvedValue(record({ userId: 'user-2' }));
    const local = createFeedbackHandlers({ ...dataSource(), getFeedback });
    const response = mockResponse();

    await local.get(request({ params: { id: FEEDBACK_ID } }), response.res);

    expect(response.statusCode).toBe(404);
  });

  it('hides feedback belonging to another tenant', async () => {
    const getFeedback = jest.fn().mockResolvedValue(record({ tenantId: 'tenant-b' }));
    const local = createFeedbackHandlers({ ...dataSource(), getFeedback });
    const response = mockResponse();

    await local.get(request({ params: { id: FEEDBACK_ID } }), response.res);

    expect(response.statusCode).toBe(404);
  });

  it('returns feedback to its owner', async () => {
    const getFeedback = jest.fn().mockResolvedValue(record());
    const local = createFeedbackHandlers({ ...dataSource(), getFeedback });
    const response = mockResponse();

    await local.get(request({ params: { id: FEEDBACK_ID } }), response.res);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      id: FEEDBACK_ID,
      userId: 'user-1',
      type: 'bug',
      subject: 'Bug',
      message: 'Something broke',
      submittedAt: SUBMITTED_AT.toISOString(),
      status: 'open',
    });
  });

  it('rejects a malformed feedback id', async () => {
    const getFeedback = jest.fn();
    const local = createFeedbackHandlers({ ...dataSource(), getFeedback });
    const response = mockResponse();

    await local.get(request({ params: { id: 'not-an-id' } }), response.res);

    expect(response.statusCode).toBe(400);
    expect(getFeedback).not.toHaveBeenCalled();
  });

  it('always attributes new feedback to the authenticated user', async () => {
    const createFeedback = jest.fn().mockResolvedValue(record());
    const local = createFeedbackHandlers({ ...dataSource(), createFeedback });
    const response = mockResponse();

    await local.create(
      request({
        body: { userId: 'attacker', type: 'bug', subject: 'Bug', message: 'Something broke' },
      }),
      response.res,
    );

    expect(createFeedback).toHaveBeenCalledWith({
      userId: 'user-1',
      type: 'bug',
      subject: 'Bug',
      message: 'Something broke',
    });
    expect(response.statusCode).toBe(201);
  });

  it('rejects an invalid feedback payload without writing', async () => {
    const createFeedback = jest.fn();
    const local = createFeedbackHandlers({ ...dataSource(), createFeedback });
    const response = mockResponse();

    await local.create(
      request({ body: { type: 'rant', subject: 'Bug', message: 'x' } }),
      response.res,
    );

    expect(response.statusCode).toBe(400);
    expect(createFeedback).not.toHaveBeenCalled();
  });

  it('updates owned feedback with the validated patch only', async () => {
    const getFeedback = jest.fn().mockResolvedValue(record());
    const updateFeedback = jest.fn().mockResolvedValue(record({ status: 'resolved' }));
    const local = createFeedbackHandlers({ ...dataSource(), getFeedback, updateFeedback });
    const response = mockResponse();

    await local.update(
      request({ params: { id: FEEDBACK_ID }, body: { status: 'resolved', userId: 'attacker' } }),
      response.res,
    );

    expect(updateFeedback).toHaveBeenCalledWith(FEEDBACK_ID, { status: 'resolved' });
    expect(response.statusCode).toBe(200);
  });

  it('rejects an empty update patch', async () => {
    const updateFeedback = jest.fn();
    const local = createFeedbackHandlers({ ...dataSource(), updateFeedback });
    const response = mockResponse();

    await local.update(request({ params: { id: FEEDBACK_ID }, body: {} }), response.res);

    expect(response.statusCode).toBe(400);
    expect(updateFeedback).not.toHaveBeenCalled();
  });

  it('rejects a processedBy that is not an object id', async () => {
    const getFeedback = jest.fn().mockResolvedValue(record());
    const updateFeedback = jest.fn();
    const local = createFeedbackHandlers({ ...dataSource(), getFeedback, updateFeedback });
    const response = mockResponse();

    await local.update(
      request({ params: { id: FEEDBACK_ID }, body: { processedBy: 'not-an-id' } }),
      response.res,
    );

    expect(response.statusCode).toBe(400);
    expect(updateFeedback).not.toHaveBeenCalled();
  });

  it('refuses to update feedback owned by another user', async () => {
    const getFeedback = jest.fn().mockResolvedValue(record({ userId: 'user-2' }));
    const updateFeedback = jest.fn();
    const local = createFeedbackHandlers({ ...dataSource(), getFeedback, updateFeedback });
    const response = mockResponse();

    await local.update(
      request({ params: { id: FEEDBACK_ID }, body: { status: 'resolved' } }),
      response.res,
    );

    expect(response.statusCode).toBe(404);
    expect(updateFeedback).not.toHaveBeenCalled();
  });

  it('deletes owned feedback', async () => {
    const getFeedback = jest.fn().mockResolvedValue(record());
    const deleteFeedback = jest.fn().mockResolvedValue(true);
    const local = createFeedbackHandlers({ ...dataSource(), getFeedback, deleteFeedback });
    const response = mockResponse();

    await local.delete(request({ params: { id: FEEDBACK_ID } }), response.res);

    expect(deleteFeedback).toHaveBeenCalledWith(FEEDBACK_ID);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ deleted: true });
  });

  it('refuses to delete feedback owned by another user', async () => {
    const getFeedback = jest.fn().mockResolvedValue(record({ userId: 'user-2' }));
    const deleteFeedback = jest.fn();
    const local = createFeedbackHandlers({ ...dataSource(), getFeedback, deleteFeedback });
    const response = mockResponse();

    await local.delete(request({ params: { id: FEEDBACK_ID } }), response.res);

    expect(response.statusCode).toBe(404);
    expect(deleteFeedback).not.toHaveBeenCalled();
  });

  it('surfaces a storage failure as a 500', async () => {
    const listFeedback = jest.fn().mockRejectedValue(new Error('boom'));
    const local = createFeedbackHandlers({ ...dataSource(), listFeedback });
    const response = mockResponse();

    await local.list(request(), response.res);

    expect(response.statusCode).toBe(500);
  });
});
