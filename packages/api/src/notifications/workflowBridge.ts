import type { WorkflowEvent, WorkflowEventHandler, WorkflowLogger } from '../workflows/types';
import type { NotificationProducer, ResolveWorkflowRecipients } from './producers';
import type { NotificationStreamHub } from './stream';
import type { NotificationsService } from './service';
import { createNotificationProducer } from './producers';

export interface WorkflowNotificationBridgeDeps {
  producer: NotificationProducer;
  /** Receives producer failures; the engine only guards synchronous handler throws. */
  logger?: WorkflowLogger;
}

export type WorkflowEventObserver = WorkflowEventHandler;

/**
 * Pure wiring helper: adapts `WorkflowEvent`s into `producer.onWorkflowEvent`
 * for use as `WorkflowEngineDeps.onEvent`. The engine invokes `onEvent`
 * synchronously and only catches synchronous throws, so this callback returns
 * `void` and contains the producer promise itself.
 */
export function connectWorkflowNotifications(
  deps: WorkflowNotificationBridgeDeps,
): WorkflowEventObserver {
  const { producer, logger } = deps;
  return (event: WorkflowEvent): void => {
    void producer.onWorkflowEvent(event).catch((error: unknown) => {
      logger?.warn('workflow notification producer failed', {
        eventType: event.type,
        runId: event.runId,
        workflowId: event.workflowId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };
}

export interface WorkflowNotificationConsumerDeps {
  notifications: NotificationsService;
  hub: NotificationStreamHub;
  /** Resolves who to notify for a terminal run event; defaults to the run owner. */
  resolveRecipients?: ResolveWorkflowRecipients;
  /** Receives producer failures; omitted means they are silently dropped. */
  logger?: WorkflowLogger;
}

export interface WorkflowNotificationConsumer {
  producer: NotificationProducer;
  /**
   * Attach to a workflow engine as `WorkflowEngineDeps.onEvent`. Every run the
   * engine drives then persists an `agent_run` notification for each resolved
   * recipient on completion, failure or cancellation.
   */
  onEvent: WorkflowEventHandler;
}

/**
 * Injection entry point for run notifications: compose the persisted producer
 * with its engine adapter over a caller-supplied notifications service, stream
 * hub and recipient resolver. The app wiring layer creates one consumer and
 * passes `onEvent` to `createWorkflowEngine`; nothing is reached for globally.
 */
export function createWorkflowNotificationConsumer(
  deps: WorkflowNotificationConsumerDeps,
): WorkflowNotificationConsumer {
  const producer = createNotificationProducer({
    notifications: deps.notifications,
    hub: deps.hub,
    resolveRecipients: deps.resolveRecipients,
  });
  const onEvent = connectWorkflowNotifications({ producer, logger: deps.logger });
  return { producer, onEvent };
}
