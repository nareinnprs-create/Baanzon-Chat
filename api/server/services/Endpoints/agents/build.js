const { logger } = require('@librechat/data-schemas');
const { loadAgent: loadAgentFn } = require('@librechat/api');
const { isAgentsEndpoint, removeNullishValues, Constants } = require('librechat-data-provider');
const { getMCPServerTools } = require('~/server/services/Config');
const { getAccessibleMCPServers } = require('~/server/services/MCP');
const { routeModel } = require('~/server/services/billing/modelRouter');
const db = require('~/models');

const loadAgent = (params) =>
  loadAgentFn(params, {
    getAgent: db.getAgent,
    getMCPServerTools,
    getAccessibleMCPServers,
  });

const buildOptions = (req, endpoint, parsedBody, endpointType) => {
  const { spec, iconURL, agent_id, chatProjectId, ...model_parameters } = parsedBody;
  // Tier x brand routing: brand keys (baanzon-*) resolve to the plan's model;
  // the tier comes from the account DB. The brand arrives on the RAW body —
  // the compact agents zod schema strips `model` from parsedBody.
  const requestedModel = String(req.body?.model || model_parameters.model || '');
  const tier = String(req.user?.subscriptionTier || 'free').toLowerCase();
  model_parameters.model = routeModel(tier, requestedModel);
  logger.info(`[modelRouter] tier=${tier} requested=${requestedModel} routed=${model_parameters.model}`);
  const agentPromise = loadAgent({
    req,
    spec,
    agent_id: isAgentsEndpoint(endpoint) ? agent_id : Constants.EPHEMERAL_AGENT_ID,
    endpoint,
    model_parameters,
  }).catch((error) => {
    logger.error(`[/agents/:${agent_id}] Error retrieving agent during build options step`, error);
    return undefined;
  });

  /** @type {import('librechat-data-provider').TConversation | undefined} */
  const addedConvo = req.body?.addedConvo;

  return removeNullishValues({
    spec,
    iconURL,
    endpoint,
    agent_id,
    endpointType,
    chatProjectId,
    model_parameters,
    agent: agentPromise,
    addedConvo,
  });
};

module.exports = { buildOptions };
