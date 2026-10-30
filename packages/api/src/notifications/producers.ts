import type { TNotificationCreateRequest, TNotificationType } from 'librechat-data-provider';
import type { WorkflowEvent, WorkflowEventType } from '../workflows/types';
import type { NotificationStreamHub } from './stream';
import type { NotificationsService } from './service';

export type WorkflowNotificationEventType = Extract<
  WorkflowEventType,
  'run.completed' | 'run.failed' | 'run.cancelled'
>;

/** Resolves who should be notified for one workflow event; defaults to the run owner. */
export type ResolveWorkflowRecipients = (event: WorkflowEvent) => readonly string[];

export interface NotificationProducerDeps {
  notifications: NotificationsService;
  hub: NotificationStreamHub;
  resolveRecipients?: ResolveWorkflowRecipients;
}

export interface NotifyUserInput {
  userId: string;
  type: TNotificationType;
  title: string;
  body?: string;
  link?: string;
  data?: Record<string, unknown>;
}

export interface NotificationProducer {
  onWorkflowEvent(event: WorkflowEvent): Promise<void>;
  notifyUser(input: NotifyUserInput): Promise<void>;
}

/** The stored type used for background-run notifications; the enum has no `workflow` member. */
const WORKFLOW_RUN_NOTIFICATION_TYPE: TNotificationType = 'agent_run';

const RUN_NOTIFICATION_TITLES: Record<WorkflowNotificationEventType, string> = {
  'run.completed': 'Workflow run completed',
  'run.failed': 'Workflow run failed',
  'run.cancelled': 'Workflow run cancelled',
};

/** Bounds the in-memory dedupe set so a long-lived process cannot grow it without limit. */
const DEDUPE_LIMIT = 1000;

function isNotificationEvent(type: WorkflowEventType): type is WorkflowNotificationEventType {
  return type === 'run.completed' || type === 'run.failed' || type === 'run.cancelled';
}

function ownerRecipients(event: WorkflowEvent): readonly string[] {
  return [event.userId];
}

function toRunNotification(
  event: WorkflowEvent,
  type: WorkflowNotificationEventType,
): TNotificationCreateRequest {
  return {
    type: WORKFLOW_RUN_NOTIFICATION_TYPE,
    title: RUN_NOTIFICATION_TITLES[type],
    body: event.message ?? `Run ${event.runId} of workflow ${event.workflowId}`,
    data: {
      workflowId: event.workflowId,
      runId: event.runId,
      eventType: type,
      state: event.state,
      at: event.at,
    },
  };
}

/**
 * Turns background run events into persisted notifications pushed over the SSE
 * hub: `service.create(...)` then `hub.publish(...)`, mirroring the REST handler.
 *
 * Terminal run events are deduped per run and recipient in a bounded in-memory
 * set, so a replayed or late terminal event never notifies twice while a failed
 * create leaves the key unset and retryable. Dedupe is per producer instance.
 */
export function createNotificationProducer(deps: NotificationProducerDeps): NotificationProducer {
  const { notifications, hub } = deps;
  const resolveRecipients = deps.resolveRecipients ?? ownerRecipients;
  const notified = new Set<string>();

  function markNotified(key: string): void {
    if (notified.size >= DEDUPE_LIMIT) {
      const oldest = notified.values().next();
      if (oldest.done !== true) {
        notified.delete(oldest.value);
      }
    }
    notified.add(key);
  }

  async function createAndPublish(
    userId: string,
    request: TNotificationCreateRequest,
  ): Promise<void> {
    const notification = await notifications.create(userId, request);
    const unreadCount = await notifications.unreadCount(userId);
    hub.publish(userId, notification, unreadCount);
  }

  async function onWorkflowEvent(event: WorkflowEvent): Promise<void> {
    if (!isNotificationEvent(event.type)) {
      return;
    }
    const request = toRunNotification(event, event.type);
    for (const userId of resolveRecipients(event)) {
      if (!userId) {
        continue;
      }
      const key = `${event.runId}:${userId}`;
      if (notified.has(key)) {
        continue;
      }
      await createAndPublish(userId, request);
      markNotified(key);
    }
  }

  async function notifyUser(input: NotifyUserInput): Promise<void> {
    await createAndPublish(input.userId, {
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
      data: input.data,
    });
  }

  return { onWorkflowEvent, notifyUser };
}
