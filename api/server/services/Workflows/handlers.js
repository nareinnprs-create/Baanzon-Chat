const { createWorkflow, getWorkflowRun, listWorkflows, getWorkflow } = require('~/models');
const logger = require('@librechat/data-schemas').logger;
const {
  startDetachedRun,
  cancelDetachedRun,
  newRunId,
} = require('./engine');

function resolveUserId(req) {
  const user = req.user;
  if (!user) {
    return null;
  }
  return user._id?.toString() ?? user.id ?? null;
}

async function list(req, res) {
  const workflows = await listWorkflows();
  return res.status(200).json({ workflows });
}

async function create(req, res) {
  const userId = resolveUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const { name, slug, description, definition, enabled } = req.body ?? {};
  const workflow = await createWorkflow({
    name,
    slug,
    description,
    definition,
    enabled,
    createdBy: userId,
  });
  return res.status(201).json({ workflow });
}

async function getRun(req, res) {
  const userId = resolveUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const run = await getWorkflowRun(userId, req.params.id);
  if (!run) {
    return res.status(404).json({ error: 'Workflow run not found' });
  }
  return res.status(200).json({ run });
}

/** Triggers a detached run of a persisted workflow; poll `GET /runs/:runId`. */
async function startRun(req, res) {
  const userId = resolveUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const workflowId = req.params.id;
  const workflow = await getWorkflow(workflowId);
  if (!workflow) {
    return res.status(404).json({ error: 'Workflow not found' });
  }
  if (workflow.enabled === false) {
    return res.status(409).json({ error: 'Workflow is disabled' });
  }
  const runId = newRunId(workflowId);
  const variables =
    req.body != null && typeof req.body.variables === 'object' && !Array.isArray(req.body.variables)
      ? req.body.variables
      : undefined;
  try {
    startDetachedRun({
      runId,
      workflowId,
      userId,
      variables,
      metadata: { triggeredBy: 'manual' },
    });
  } catch (error) {
    logger.error('[workflows] Failed to start run', error);
    return res.status(500).json({ error: 'Failed to start workflow run' });
  }
  return res.status(202).json({ runId });
}

/** Cancels a detached run this user started; no-op for finished runs. */
async function cancelRun(req, res) {
  const userId = resolveUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const cancelled = cancelDetachedRun(userId, req.params.runId, req.body?.reason);
  if (!cancelled) {
    return res.status(404).json({ error: 'No active run to cancel' });
  }
  return res.status(200).json({ cancelled: true });
}

module.exports = { handlers: { list, create, getRun, startRun, cancelRun } };
