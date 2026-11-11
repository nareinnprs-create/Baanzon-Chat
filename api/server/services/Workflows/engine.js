const { randomUUID } = require('crypto');
const { createWorkflowEngine, createLocalWorkflowExecutor } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const {
  getWorkflow,
  startWorkflowRun,
  getWorkflowRun,
  markWorkflowRunRunning,
  completeWorkflowRun,
  recordWorkflowRunStep,
} = require('~/models');

/**
 * Glue between the workflow engine and this deployment's persistence: store
 * adapters over the data-schemas methods, the local step executor, and a
 * controller map so a detached run can still be cancelled. The engine owns
 * every state transition; this file only translates shapes.
 */

let engineInstance;

function buildEngine() {
  return createWorkflowEngine({
    workflows: {
      async getWorkflow(workflowId) {
        const doc = await getWorkflow(workflowId);
        if (!doc) {
          return null;
        }
        return {
          id: doc._id.toString(),
          enabled: doc.enabled !== false,
          definition: doc.definition,
        };
      },
    },
    runs: {
      async createRun(input) {
        await startWorkflowRun({
          runId: input.runId,
          workflowId: input.workflowId,
          user: input.userId,
          metadata: input.metadata,
        });
        return {
          runId: input.runId,
          workflowId: input.workflowId,
          userId: input.userId,
          state: 'queued',
        };
      },
      async getRun(userId, runId) {
        const doc = await getRunRecord(userId, runId);
        if (!doc) {
          return null;
        }
        return {
          runId: doc.runId,
          workflowId: doc.workflowId?.toString(),
          userId: doc.user?.toString(),
          state: doc.status === 'pending' ? 'queued' : doc.status,
          steps: doc.steps,
          nextStepId: doc.nextStepId,
          error: doc.error,
        };
      },
      async transition(input) {
        switch (input.to) {
          case 'queued':
            await startWorkflowRun({
              runId: input.runId,
              workflowId: input.workflowId,
              user: input.userId,
            });
            break;
          case 'running':
            await markWorkflowRunRunning(input.userId, input.runId);
            break;
          case 'paused':
            // No server-side resume surface yet: the run stays recorded as
            // running while the engine holds at the next step boundary.
            await markWorkflowRunRunning(input.userId, input.runId);
            break;
          case 'completed':
            await completeWorkflowRun(input.userId, input.runId, {
              status: 'succeeded',
              steps: input.steps,
            });
            break;
          case 'failed':
            await completeWorkflowRun(input.userId, input.runId, {
              status: 'failed',
              error: input.reason,
              steps: input.steps,
            });
            break;
          case 'cancelled':
            await completeWorkflowRun(input.userId, input.runId, {
              status: 'cancelled',
              error: input.reason,
              steps: input.steps,
            });
            break;
        }
        return {
          runId: input.runId,
          workflowId: input.workflowId,
          userId: input.userId,
          state: input.to,
        };
      },
      async recordStep(input) {
        await recordWorkflowRunStep({
          user: input.userId,
          runId: input.runId,
          result: input.result,
          nextStepId: input.nextStepId,
          variables: input.variables,
        });
      },
    },
    executor: createLocalWorkflowExecutor(),
    logger,
  });
}

function getEngine() {
  if (engineInstance == null) {
    engineInstance = buildEngine();
  }
  return engineInstance;
}

const controllers = new Map();

function controllerKey(userId, runId) {
  return `${userId}:${runId}`;
}

/** Starts a detached run and returns its handle for cancellation. */
function startDetachedRun({ runId, workflowId, userId, variables, metadata }) {
  const handle = getEngine().start({
    runId,
    workflowId,
    userId,
    variables,
    metadata,
  });
  controllers.set(controllerKey(userId, runId), handle.controller);
  return handle;
}

function cancelDetachedRun(userId, runId, reason) {
  const key = controllerKey(userId, runId);
  const controller = controllers.get(key);
  if (controller == null) {
    return false;
  }
  controllers.delete(key);
  controller.cancel(reason);
  return true;
}

function newRunId(workflowId) {
  return `${workflowId}-${randomUUID()}`;
}

module.exports = {
  getEngine,
  startDetachedRun,
  cancelDetachedRun,
  newRunId,
  controllers,
};
