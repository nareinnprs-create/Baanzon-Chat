const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const { ViolationTypes } = require('librechat-data-provider');
const { limiterCache, removePorts } = require('@librechat/api');
const logViolation = require('~/cache/logViolation');

/**
 * Bounds Knowledge-base requests — retrieval and ingest — which are authenticated
 * but otherwise uncapped, and whose ingest path can fan out to embeddings-provider
 * calls. Two windows are enforced: one per IP and one per signed-in user, so a
 * single account cannot exhaust an embeddings budget and an anonymous address
 * cannot mint fresh buckets by rotating.
 */
const getEnvironmentVariables = () => {
  const KNOWLEDGE_IP_MAX = parseInt(process.env.KNOWLEDGE_IP_MAX) || 200;
  const KNOWLEDGE_IP_WINDOW = parseInt(process.env.KNOWLEDGE_IP_WINDOW) || 1;
  const KNOWLEDGE_USER_MAX = parseInt(process.env.KNOWLEDGE_USER_MAX) || 100;
  const KNOWLEDGE_USER_WINDOW = parseInt(process.env.KNOWLEDGE_USER_WINDOW) || 1;
  const KNOWLEDGE_VIOLATION_SCORE = process.env.KNOWLEDGE_VIOLATION_SCORE ?? 0;

  const knowledgeIpWindowMs = KNOWLEDGE_IP_WINDOW * 60 * 1000;
  const knowledgeIpMax = KNOWLEDGE_IP_MAX;
  const knowledgeIpWindowInMinutes = knowledgeIpWindowMs / 60000;

  const knowledgeUserWindowMs = KNOWLEDGE_USER_WINDOW * 60 * 1000;
  const knowledgeUserMax = KNOWLEDGE_USER_MAX;
  const knowledgeUserWindowInMinutes = knowledgeUserWindowMs / 60000;

  return {
    knowledgeIpWindowMs,
    knowledgeIpMax,
    knowledgeIpWindowInMinutes,
    knowledgeUserWindowMs,
    knowledgeUserMax,
    knowledgeUserWindowInMinutes,
    knowledgeViolationScore: KNOWLEDGE_VIOLATION_SCORE,
  };
};

/** Groups IPv6 clients by subnet so an address rotation cannot mint a fresh bucket. */
const knowledgeIpKey = (req) => {
  const address = removePorts(req);
  return address == null ? address : ipKeyGenerator(address);
};

const createKnowledgeHandler = (ip = true) => {
  const {
    knowledgeIpMax,
    knowledgeUserMax,
    knowledgeViolationScore,
    knowledgeIpWindowInMinutes,
    knowledgeUserWindowInMinutes,
  } = getEnvironmentVariables();

  return async (req, res) => {
    const type = ViolationTypes.KNOWLEDGE_LIMIT;
    const errorMessage = {
      type,
      max: ip ? knowledgeIpMax : knowledgeUserMax,
      limiter: ip ? 'ip' : 'user',
      windowInMinutes: ip ? knowledgeIpWindowInMinutes : knowledgeUserWindowInMinutes,
    };

    await logViolation(req, res, type, errorMessage, knowledgeViolationScore);
    res.status(429).json({ message: 'Too many knowledge requests. Try again later' });
  };
};

const createKnowledgeLimiters = () => {
  const { knowledgeIpWindowMs, knowledgeIpMax, knowledgeUserWindowMs, knowledgeUserMax } =
    getEnvironmentVariables();

  const ipLimiterOptions = {
    windowMs: knowledgeIpWindowMs,
    max: knowledgeIpMax,
    handler: createKnowledgeHandler(),
    keyGenerator: knowledgeIpKey,
    store: limiterCache('knowledge_ip_limiter'),
  };
  const userLimiterOptions = {
    windowMs: knowledgeUserWindowMs,
    max: knowledgeUserMax,
    handler: createKnowledgeHandler(false),
    skip: function (req) {
      return req.user?.id == null;
    },
    keyGenerator: function (req) {
      return req.user.id;
    },
    store: limiterCache('knowledge_user_limiter'),
  };

  const knowledgeIpLimiter = rateLimit(ipLimiterOptions);
  const knowledgeUserLimiter = rateLimit(userLimiterOptions);
  return { knowledgeIpLimiter, knowledgeUserLimiter };
};

module.exports = { createKnowledgeLimiters };
