import type { TNotification, TNotificationCreateRequest } from 'librechat-data-provider';
import type { WorkflowEvent, WorkflowEventType } from '../workflows/types';
import type { NotificationStreamHub } from './stream';
import type { NotificationsService } from './service';
import type { NotifyUserInput } from './producers';
import { createNotificationProducer } from './producers';

interface FakeService {
  service: NotificationsService;
  creates: Array<{ userId: string; request: TNotificationCreateRequest }>;
}

function makeService(overrides: Partial<NotificationsService> = {}): FakeService {
  const creates: Array<{ userId: string; request: TNotificationCreateRequest }> = [];
  let unread = 0;
  let sequence = 0;
  const service: NotificationsService = {
    list: async () => ({ notifications: [], unreadCount: 0, hasMore: false }),
    create: async (userId, request) => {
      creates.push({ userId, request });
      unread += 1;
      sequence += 1;
      return {
        id: `n-${sequence}`,
        type: request.type,
        title: request.title,
        body: request.body,
        link: request.link,
        read: false,
        readAt: null,
        data: request.data,
        createdAt: '2026-01-01T00:00:00.000Z',
      };
    },
    markRead: async () => null,
    markAllRead: async () => 0,
    remove: async () => false,
    unreadCount: async () => unread,
    ...overrides,
  };
  return { service, creates };
}

interface FakeHub {
  hub: NotificationStreamHub;
  published: Array<{ userId: string; notification: TNotification; unreadCount?: number }>;
}

function makeHub(): FakeHub {
  const published: Array<{ userId: string; notification: TNotification; unreadCount?: number }> =
    [];
  const hub: NotificationStreamHub = {
    subscribe: () => undefined,
    publish: (userId, notification, unreadCount) => {
      published.push({ userId, notification, unreadCount });
    },
    connectionCount: () => 0,
    close: () => undefined,
  };
  return { hub, published };
}

function makeEvent(overrides: Partial<WorkflowEvent> = {}): WorkflowEvent {
  return {
    type: 'run.completed',
    runId: 'run-1',
    workflowId: 'workflow-1',
    userId: 'user-1',
    state: 'completed',
    at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('createNotificationProducer', () => {
  it('creates and publishes exactly one notification for a completed run', async () => {
    const { service, creates } = makeService();
    const { hub, published } = makeHub();
    const producer = createNotificationProducer({ notifications: service, hub });

    await producer.onWorkflowEvent(makeEvent({ type: 'run.completed' }));

    expect(creates).toHaveLength(1);
    expect(creates[0].userId).toBe('user-1');
    expect(creates[0].request).toEqual({
      type: 'agent_run',
      title: 'Workflow run completed',
      body: 'Run run-1 of workflow workflow-1',
      data: {
        workflowId: 'workflow-1',
        runId: 'run-1',
        eventType: 'run.completed',
        state: 'completed',
        at: '2026-01-01T00:00:00.000Z',
      },
    });
    expect(published).toHaveLength(1);
    expect(published[0].userId).toBe('user-1');
    expect(published[0].unreadCount).toBe(1);
    expect(published[0].notification).toMatchObject({
      id: 'n-1',
      type: 'agent_run',
      title: 'Workflow run completed',
      read: false,
    });
  });

  it.each([
    ['run.failed', 'failed', 'Workflow run failed'],
    ['run.cancelled', 'cancelled', 'Workflow run cancelled'],
  ] as const)('creates exactly one notification for %s', async (type, state, title) => {
    const { service, creates } = makeService();
    const { hub, published } = makeHub();
    const producer = createNotificationProducer({ notifications: service, hub });

    await producer.onWorkflowEvent(makeEvent({ type, state }));

    expect(creates).toHaveLength(1);
    expect(creates[0].userId).toBe('user-1');
    expect(creates[0].request.type).toBe('agent_run');
    expect(creates[0].request.title).toBe(title);
    expect(published).toHaveLength(1);
    expect(published[0].notification.id).toBe('n-1');
  });

  it('uses the event message as the notification body when present', async () => {
    const { service, creates } = makeService();
    const { hub } = makeHub();
    const producer = createNotificationProducer({ notifications: service, hub });

    await producer.onWorkflowEvent(
      makeEvent({ type: 'run.failed', state: 'failed', message: 'executor exploded' }),
    );

    expect(creates[0].request.body).toBe('executor exploded');
  });

  it.each([
    'run.queued',
    'run.started',
    'run.paused',
    'run.resumed',
    'step.started',
    'step.retrying',
    'step.succeeded',
    'step.failed',
    'step.skipped',
  ] as const)('ignores %s without creating or publishing', async (type: WorkflowEventType) => {
    const { service, creates } = makeService();
    const { hub, published } = makeHub();
    const producer = createNotificationProducer({ notifications: service, hub });

    await producer.onWorkflowEvent(makeEvent({ type, state: 'running' }));

    expect(creates).toHaveLength(0);
    expect(published).toHaveLength(0);
  });

  it('ignores a failed step event even when the run state reads failed', async () => {
    const { service, creates } = makeService();
    const { hub, published } = makeHub();
    const producer = createNotificationProducer({ notifications: service, hub });

    await producer.onWorkflowEvent(
      makeEvent({
        type: 'step.failed',
        state: 'failed',
        stepId: 's1',
        attempt: 3,
        message: 'boom',
      }),
    );

    expect(creates).toHaveLength(0);
    expect(published).toHaveLength(0);
  });

  it('is idempotent when the same terminal event is delivered twice', async () => {
    const { service, creates } = makeService();
    const { hub, published } = makeHub();
    const producer = createNotificationProducer({ notifications: service, hub });
    const event = makeEvent({ type: 'run.completed' });

    await producer.onWorkflowEvent(event);
    await producer.onWorkflowEvent(event);

    expect(creates).toHaveLength(1);
    expect(published).toHaveLength(1);
  });

  it('drops a late terminal event for a run that was already notified', async () => {
    const { service, creates } = makeService();
    const { hub, published } = makeHub();
    const producer = createNotificationProducer({ notifications: service, hub });

    await producer.onWorkflowEvent(makeEvent({ type: 'run.completed' }));
    await producer.onWorkflowEvent(
      makeEvent({ type: 'run.failed', state: 'failed', message: 'late replay' }),
    );

    expect(creates).toHaveLength(1);
    expect(published).toHaveLength(1);
  });

  it('keeps the dedupe key unset when create fails so the event can retry', async () => {
    const { service, creates } = makeService();
    const { hub, published } = makeHub();
    const baseCreate = service.create;
    let attempts = 0;
    const flaky: NotificationsService = {
      ...service,
      create: (userId, request) => {
        attempts += 1;
        if (attempts === 1) {
          return Promise.reject(new Error('db down'));
        }
        return baseCreate(userId, request);
      },
    };
    const producer = createNotificationProducer({ notifications: flaky, hub });
    const event = makeEvent({ type: 'run.failed', state: 'failed' });

    await expect(producer.onWorkflowEvent(event)).rejects.toThrow('db down');
    await producer.onWorkflowEvent(event);

    expect(creates).toHaveLength(1);
    expect(published).toHaveLength(1);
  });

  it('notifies each resolved recipient exactly once', async () => {
    const { service, creates } = makeService();
    const { hub, published } = makeHub();
    const producer = createNotificationProducer({
      notifications: service,
      hub,
      resolveRecipients: (event) => [event.userId, 'user-2'],
    });
    const event = makeEvent({ type: 'run.completed' });

    await producer.onWorkflowEvent(event);
    await producer.onWorkflowEvent(event);

    expect(creates.map((entry) => entry.userId)).toEqual(['user-1', 'user-2']);
    expect(published.map((entry) => entry.userId)).toEqual(['user-1', 'user-2']);
  });

  it('bounds the dedupe set so a replayed run is only suppressed while it is retained', async () => {
    const { service, creates } = makeService();
    const { hub } = makeHub();
    const producer = createNotificationProducer({ notifications: service, hub });

    for (let i = 0; i < 1000; i++) {
      await producer.onWorkflowEvent(makeEvent({ runId: `run-${i}` }));
    }
    expect(creates).toHaveLength(1000);

    await producer.onWorkflowEvent(makeEvent({ runId: 'run-1000' }));
    await producer.onWorkflowEvent(makeEvent({ runId: 'run-1000' }));
    expect(creates).toHaveLength(1001);

    await producer.onWorkflowEvent(makeEvent({ runId: 'run-0' }));
    expect(creates).toHaveLength(1002);
    expect(creates[1001].request.data).toMatchObject({ runId: 'run-0' });
  });

  it('creates nothing when the recipient resolver returns no one', async () => {
    const { service, creates } = makeService();
    const { hub, published } = makeHub();
    const producer = createNotificationProducer({
      notifications: service,
      hub,
      resolveRecipients: () => [],
    });

    await producer.onWorkflowEvent(makeEvent({ type: 'run.completed' }));

    expect(creates).toHaveLength(0);
    expect(published).toHaveLength(0);
  });
});

describe('notifyUser', () => {
  it('creates and publishes a caller-shaped notification for the given user', async () => {
    const { service, creates } = makeService();
    const { hub, published } = makeHub();
    const producer = createNotificationProducer({ notifications: service, hub });
    const input: NotifyUserInput = {
      userId: 'user-9',
      type: 'system',
      title: 'Maintenance window',
      body: 'Tonight at 22:00',
      link: 'https://example.test/notice/1',
      data: { severity: 'info' },
    };

    await producer.notifyUser(input);

    expect(creates).toHaveLength(1);
    expect(creates[0]).toEqual({
      userId: 'user-9',
      request: {
        type: 'system',
        title: 'Maintenance window',
        body: 'Tonight at 22:00',
        link: 'https://example.test/notice/1',
        data: { severity: 'info' },
      },
    });
    expect(published).toHaveLength(1);
    expect(published[0].userId).toBe('user-9');
    expect(published[0].unreadCount).toBe(1);
    expect(published[0].notification).toMatchObject({ id: 'n-1', type: 'system' });
  });

  it('does not dedupe successive calls', async () => {
    const { service, creates } = makeService();
    const { hub, published } = makeHub();
    const producer = createNotificationProducer({ notifications: service, hub });
    const input: NotifyUserInput = { userId: 'user-9', type: 'share', title: 'Shared with you' };

    await producer.notifyUser(input);
    await producer.notifyUser(input);

    expect(creates).toHaveLength(2);
    expect(published).toHaveLength(2);
  });
});
