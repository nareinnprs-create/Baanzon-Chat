const { logger } = require('@librechat/data-schemas');
const {
  loadAgent: loadAgentFn,
  assertChatModelLane,
  resolveVisionModel,
} = require('@librechat/api');
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
  const requestedLane = String(req.body?.lane || model_parameters.lane || '').toLowerCase();
  assertChatModelLane(requestedLane || undefined);
  const routedModel =
    requestedLane === 'vision'
      ? resolveVisionModel(requestedModel || undefined, req.config?.modelLanes?.visionModels)
      : requestedModel;
  delete model_parameters.lane;
  const tier = String(req.user?.subscriptionTier || 'free').toLowerCase();
  const routedCfg = routeModel(tier, routedModel, requestedLane) || { model: routedModel };
  model_parameters.model = routedCfg.model;
  if (routedCfg.maxContextTokens) model_parameters.maxContextTokens = routedCfg.maxContextTokens;
  if (routedCfg.max_tokens) model_parameters.max_tokens = routedCfg.max_tokens;
  logger.info(
    `[modelRouter] tier=${tier} requested=${requestedModel} routed=${model_parameters.model} ctx=${model_parameters.maxContextTokens} out=${model_parameters.max_tokens}`,
  );
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
