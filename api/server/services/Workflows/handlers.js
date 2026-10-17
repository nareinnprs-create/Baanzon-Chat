const { createWorkflow, getWorkflowRun, listWorkflows } = require('~/models');

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

module.exports = { handlers: { list, create, getRun } };
