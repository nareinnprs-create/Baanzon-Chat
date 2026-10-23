import type {
  CreateRunInput,
  StepResult,
  WorkflowEvent,
  WorkflowExecutionContext,
  WorkflowLogger,
  WorkflowRunRecord,
  WorkflowRunTransition,
  WorkflowStepRecord,
} from '../workflows/types';
import type { NotificationProducer } from './producers';
import type { NotificationStreamHub } from './stream';
import type { NotificationsService } from './service';
import { connectWorkflowNotifications, createWorkflowNotificationConsumer } from './workflowBridge';
import { createWorkflowEngine } from '../workflows/engine';
import { createNotificationProducer } from './producers';

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

function makeSpyProducer(): { producer: NotificationProducer; events: WorkflowEvent[] } {
  const events: WorkflowEvent[] = [];
  const producer: NotificationProducer = {
    onWorkflowEvent: async (event) => {
      events.push(event);
    },
    notifyUser: async () => undefined,
  };
  return { producer, events };
}

function makeLogger(): {
  logger: WorkflowLogger;
  warnings: Array<{ message: string; meta?: Record<string, unknown> }>;
} {
  const warnings: Array<{ message: string; meta?: Record<string, unknown> }> = [];
  const logger: WorkflowLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (message, meta) => {
      warnings.push({ message, meta });
    },
    error: () => undefined,
  };
  return { logger, warnings };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeFakeService(creates: Array<{ userId: string; title: string }>): NotificationsService {
  return {
    list: async () => ({ notifications: [], unreadCount: 0, hasMore: false }),
    create: async (userId, request) => {
      creates.push({ userId, title: request.title });
      return {
        id: 'n-1',
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
    unreadCount: async () => 4,
  };
}

function makeFakeHub(
  published: Array<{ userId: string; notificationId: string; unreadCount?: number }>,
): NotificationStreamHub {
  return {
    subscribe: () => undefined,
    publish: (userId, notification, unreadCount) => {
      published.push({ userId, notificationId: notification.id, unreadCount });
    },
    connectionCount: () => 0,
    close: () => undefined,
  };
}

describe('connectWorkflowNotifications', () => {
  it('returns an onEvent callback that forwards every event to the producer', () => {
    const { producer, events } = makeSpyProducer();
    const onEvent = connectWorkflowNotifications({ producer });
    const completed = makeEvent({ type: 'run.completed' });
    const step = makeEvent({ type: 'step.failed', state: 'running', stepId: 's1' });

    expect(onEvent(completed)).toBeUndefined();
    onEvent(step);

    expect(events).toEqual([completed, step]);
  });

  it('adapts a terminal run event into one persisted notification over the hub', async () => {
    const creates: Array<{ userId: string; title: string }> = [];
    const published: Array<{ userId: string; notificationId: string; unreadCount?: number }> = [];
    const producer = createNotificationProducer({
      notifications: makeFakeService(creates),
      hub: makeFakeHub(published),
    });
    const onEvent = connectWorkflowNotifications({ producer });

    onEvent(makeEvent({ type: 'run.completed' }));
    await flush();

    expect(creates).toEqual([{ userId: 'user-1', title: 'Workflow run completed' }]);
    expect(published).toEqual([{ userId: 'user-1', notificationId: 'n-1', unreadCount: 4 }]);

    onEvent(makeEvent({ type: 'step.failed', state: 'running', stepId: 's1' }));
    await flush();

    expect(creates).toHaveLength(1);
    expect(published).toHaveLength(1);
  });

  it('contains producer rejections and reports them through the logger', async () => {
    const { logger, warnings } = makeLogger();
    const producer: NotificationProducer = {
      onWorkflowEvent: async () => {
        throw new Error('boom');
      },
      notifyUser: async () => undefined,
    };
    const onEvent = connectWorkflowNotifications({ producer, logger });
    const event = makeEvent({ type: 'run.failed', state: 'failed' });

    expect(() => onEvent(event)).not.toThrow();
    await flush();

    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toBe('workflow notification producer failed');
    expect(warnings[0].meta).toMatchObject({
      eventType: 'run.failed',
      runId: 'run-1',
      workflowId: 'workflow-1',
      error: 'boom',
    });
  });

  it('keeps rejections contained when no logger is configured', async () => {
    const producer: NotificationProducer = {
      onWorkflowEvent: async () => {
        throw new Error('boom');
      },
      notifyUser: async () => undefined,
    };
    const onEvent = connectWorkflowNotifications({ producer });

    expect(() => onEvent(makeEvent())).not.toThrow();
    await flush();
  });
});

function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('waitFor timed out'));
        return;
      }
      setTimeout(tick, 5);
    };
    tick();
  });
}

function makeRunStore() {
  const transitions: WorkflowRunTransition[] = [];
  const stepRecords: WorkflowStepRecord[] = [];
  let record: WorkflowRunRecord = {
    runId: 'run-1',
    workflowId: 'wf-1',
    userId: 'user-1',
    state: 'queued',
    steps: {},
  };
  return {
    transitions,
    stepRecords,
    async createRun(input: CreateRunInput) {
      record = { ...record, ...input, state: 'queued' };
      return record;
    },
    async getRun() {
      return record;
    },
    async transition(input: WorkflowRunTransition) {
      transitions.push(input);
      record = { ...record, state: input.to, steps: input.steps ?? record.steps };
      return record;
    },
    async recordStep(input: WorkflowStepRecord) {
      stepRecords.push(input);
    },
  };
}

function makeWorkflowStore(definition: Record<string, unknown>, enabled = true) {
  return {
    async getWorkflow() {
      return { id: 'wf-1', enabled, definition };
    },
  };
}

const fixedClock = (): Date => new Date('2026-01-01T00:00:00.000Z');

const okStep = async (ctx: WorkflowExecutionContext): Promise<StepResult> => ({
  stepId: ctx.step.id,
  status: 'succeeded',
  output: { ran: ctx.step.id },
  attempts: ctx.attempt,
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:00:01.000Z',
  durationMs: 1000,
});

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });
}

describe('createWorkflowNotificationConsumer', () => {
  it('persists exactly one notification for a completed run, ignoring step events', async () => {
    const creates: Array<{ userId: string; title: string }> = [];
    const published: Array<{ userId: string; notificationId: string; unreadCount?: number }> = [];
    const consumer = createWorkflowNotificationConsumer({
      notifications: makeFakeService(creates),
      hub: makeFakeHub(published),
    });
    const engine = createWorkflowEngine({
      workflows: makeWorkflowStore({
        steps: [
          { id: 's1', type: 'transform' },
          { id: 's2', type: 'transform' },
        ],
      }),
      runs: makeRunStore(),
      executor: { execute: okStep },
      clock: fixedClock,
      onEvent: consumer.onEvent,
    });

    const result = await engine.run({ runId: 'run-1', workflowId: 'wf-1', userId: 'user-1' });
    await waitFor(() => creates.length > 0);

    expect(result.state).toBe('completed');
    expect(creates).toEqual([{ userId: 'user-1', title: 'Workflow run completed' }]);
    expect(published).toEqual([{ userId: 'user-1', notificationId: 'n-1', unreadCount: 4 }]);
  });

  it('persists exactly one notification for a failed run', async () => {
    const creates: Array<{ userId: string; title: string }> = [];
    const published: Array<{ userId: string; notificationId: string; unreadCount?: number }> = [];
    const consumer = createWorkflowNotificationConsumer({
      notifications: makeFakeService(creates),
      hub: makeFakeHub(published),
    });
    const engine = createWorkflowEngine({
      workflows: makeWorkflowStore({ steps: [{ id: 's1', type: 'transform' }] }),
      runs: makeRunStore(),
      executor: {
        execute: () => {
          throw new Error('executor exploded');
        },
      },
      clock: fixedClock,
      onEvent: consumer.onEvent,
    });

    const result = await engine.run({ runId: 'run-1', workflowId: 'wf-1', userId: 'user-1' });
    await waitFor(() => creates.length > 0);

    expect(result.state).toBe('failed');
    expect(creates).toEqual([{ userId: 'user-1', title: 'Workflow run failed' }]);
    expect(published).toHaveLength(1);
  });

  it('persists exactly one notification for a cancelled run', async () => {
    const creates: Array<{ userId: string; title: string }> = [];
    const published: Array<{ userId: string; notificationId: string; unreadCount?: number }> = [];
    const consumer = createWorkflowNotificationConsumer({
      notifications: makeFakeService(creates),
      hub: makeFakeHub(published),
    });
    const engine = createWorkflowEngine({
      workflows: makeWorkflowStore({
        steps: [
          { id: 's1', type: 'delay', delayMs: 50 },
          { id: 's2', type: 'transform' },
        ],
      }),
      runs: makeRunStore(),
      executor: { execute: okStep },
      clock: fixedClock,
      sleep: abortableSleep,
      onEvent: consumer.onEvent,
    });

    const handle = engine.start({ runId: 'run-1', workflowId: 'wf-1', userId: 'user-1' });
    setTimeout(() => handle.controller.cancel(), 0);
    const result = await handle.completion;
    await waitFor(() => creates.length > 0);

    expect(result.state).toBe('cancelled');
    expect(creates).toEqual([{ userId: 'user-1', title: 'Workflow run cancelled' }]);
    expect(published).toHaveLength(1);
  });

  it('notifies each resolved recipient once and dedupes duplicate terminal events', async () => {
    const creates: Array<{ userId: string; title: string }> = [];
    const published: Array<{ userId: string; notificationId: string; unreadCount?: number }> = [];
    const consumer = createWorkflowNotificationConsumer({
      notifications: makeFakeService(creates),
      hub: makeFakeHub(published),
      resolveRecipients: (event) => [event.userId, 'user-2'],
    });
    const engine = createWorkflowEngine({
      workflows: makeWorkflowStore({ steps: [{ id: 's1', type: 'transform' }] }),
      runs: makeRunStore(),
      executor: { execute: okStep },
      clock: fixedClock,
      onEvent: consumer.onEvent,
    });

    await engine.run({ runId: 'run-1', workflowId: 'wf-1', userId: 'user-1' });
    await waitFor(() => creates.length >= 2);

    expect(creates.map((entry) => entry.userId)).toEqual(['user-1', 'user-2']);

    consumer.onEvent(makeEvent({ type: 'run.completed' }));
    consumer.onEvent(makeEvent({ type: 'run.completed' }));
    await flush();

    expect(creates).toHaveLength(2);
    expect(published).toHaveLength(2);
  });
});
