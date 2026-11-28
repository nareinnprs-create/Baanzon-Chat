/**
 * Voice Mode WebSocket wiring (thin, per workspace rules — all behavior lives
 * in @librechat/api's createVoiceGateway). One upgrade path:
 * /api/voice/realtime. The browser passes the JWT as the WebSocket
 * subprotocol (there is no jwt cookie), so `handleProtocols` must echo it
 * back or the browser aborts the handshake.
 */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { WebSocketServer } = require('ws');
const { logger } = require('@librechat/data-schemas');
const { createVoiceGateway, buildVoiceConfig } = require('@librechat/api');
const { synthesize } = require('~/server/services/Voice/ttsLadder');
const loadCustomConfig = require('~/server/services/Config/loadCustomConfig');
const { saveMessage, getMessages, saveConvo, getConvo } = require('~/models');

const REALTIME_PATH = '/api/voice/realtime';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTEXT_TURNS = 12;
/** Reconnect spam would open paid provider sockets; cap attempts per IP/min. */
const MAX_CONN_PER_MINUTE = 10;

// Same in-memory pattern as images-generate: small key space, pruned on use.
const connHits = new Map();
function connLimited(ip) {
  const now = Date.now();
  const hits = (connHits.get(ip) || []).filter((t) => now - t < 60_000);
  hits.push(now);
  connHits.set(ip, hits);
  return hits.length > MAX_CONN_PER_MINUTE;
}

function counters() {
  return mongoose.connection.db.collection('usage_counters');
}

function voiceDay() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

async function usedSeconds(userId) {
  const counter = await counters().findOne({ key: `voice:${userId}:${voiceDay()}` });
  return counter?.count || 0;
}

/** Wall-clock metering; the session already caps each interval. */
function addSeconds(userId, tier, seconds) {
  counters()
    .updateOne(
      { key: `voice:${userId}:${voiceDay()}` },
      {
        $setOnInsert: { userId, date: voiceDay(), kind: 'voice' },
        $inc: { count: seconds },
      },
      { upsert: true },
    )
    .catch((err) => logger.warn('[voiceGateway] metering write failed', err));
}

async function tierOf(userId) {
  const user = await mongoose.connection.db
    .collection('users')
    .findOne(
      { _id: new mongoose.Types.ObjectId(String(userId)) },
      { projection: { subscriptionTier: 1 } },
    );
  return String(user?.subscriptionTier || 'free').toLowerCase();
}

/**
 * Thread snapshot for the session. Existing conversation (must belong to the
 * user) → last turns + chain anchor; otherwise create a voice conversation.
 */
async function loadContext(userId, conversationId) {
  let cid = conversationId;
  if (cid && UUID_RE.test(cid)) {
    const convo = await getConvo(userId, cid).catch(() => null);
    if (!convo) {
      cid = null;
    }
  } else {
    cid = null;
  }
  if (!cid) {
    cid = crypto.randomUUID();
    await saveConvo(
      { userId },
      {
        conversationId: cid,
        endpoint: 'agents',
        model: 'baanzon-voice',
        title: 'Voice chat',
      },
      { context: 'api/server/services/Voice/voiceGateway.js - new voice conversation' },
    );
  }
  // Last-12 in chronological order for the LLM history.
  const docs = await getMessages(
    { user: userId, conversationId: cid },
    'messageId sender text createdAt',
    { sort: { createdAt: -1 }, limit: CONTEXT_TURNS },
  );
  const recent = (Array.isArray(docs) ? docs : []).reverse();
  return {
    conversationId: cid,
    turns: recent
      .filter((m) => m?.text && (m.sender === 'User' || m.sender === 'baanzon-voice'))
      .map((m) => ({
        role: m.sender === 'User' ? 'user' : 'assistant',
        text: m.text,
      }))
      .slice(-CONTEXT_TURNS),
    parentMessageId: recent.length
      ? (recent[recent.length - 1].messageId?.toString() ?? null)
      : null,
  };
}

/**
 * Persist one turn. Voice turns carry the generic 'baanzon-voice' model and
 * the agents endpoint; users never see (or store) a provider identity.
 */
async function saveTurn({ userId, conversationId, parentMessageId, role, text }) {
  const saved = await saveMessage(
    { userId },
    {
      conversationId,
      parentMessageId: parentMessageId || undefined,
      sender: role === 'user' ? 'User' : 'baanzon-voice',
      isCreatedByUser: role === 'user',
      text,
      model: 'baanzon-voice',
      endpoint: 'agents',
      error: false,
      unfinished: false,
      user: userId,
    },
    { context: 'api/server/services/Voice/voiceGateway.js - voice turn' },
  );
  return saved?.messageId?.toString() ?? saved?._id?.toString() ?? null;
}

function verifyToken(token) {
  return new Promise((resolve) => {
    jwt.verify(token, process.env.JWT_SECRET, (err, payload) => {
      resolve(err || !payload?.id ? null : String(payload.id));
    });
  });
}

async function attachVoiceGateway(server) {
  const customConfig = await loadCustomConfig(false).catch(() => null);
  const config = buildVoiceConfig(customConfig?.voice ?? null);
  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN;
  const llm = {
    baseUrl: process.env.OPRAIZ_BASEURL,
    apiKey: process.env.OPRAIZ_API_KEY,
  };
  if (!config.enabled || !accountId || !token || !llm.baseUrl || !llm.apiKey) {
    logger.warn('[voiceGateway] voice mode disabled: missing config or credentials');
    return null;
  }

  const gateway = createVoiceGateway({
    config,
    cf: { accountId, token },
    llm,
    verifyToken,
    tierOf,
    usedSeconds,
    addSeconds: (userId, tier, seconds) => addSeconds(userId, tier, seconds),
    synthesize,
    store: {
      loadContext: (userId, cid) =>
        loadContext(userId, cid).catch((err) => {
          logger.error('[voiceGateway] loadContext failed', err);
          return null;
        }),
      saveTurn: (input) =>
        saveTurn(input).catch((err) => {
          logger.error('[voiceGateway] saveTurn failed', err);
          return null;
        }),
    },
    log: (level, message, meta) => logger[level](`[voiceGateway] ${message}`, meta),
  });

  const wss = new WebSocketServer({
    noServer: true,
    // Echo the client's subprotocol (carries the JWT) or browsers abort.
    // `protocols` is a Set; index access is always undefined and ws would
    // serialize the boolean fallback into the response header. Echo the
    // client's first offered protocol (the auth token) instead.
    handleProtocols: (protocols) =>
      (protocols instanceof Set ? [...protocols][0] : protocols?.[0]) ?? true,
  });

  server.on('upgrade', (req, socket, head) => {
    if (req.url?.split('?')[0] !== REALTIME_PATH) {
      return;
    }
    if (connLimited(req.socket?.remoteAddress || 'unknown')) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    // Token rides the subprotocol header; cid rides the query string.
    const token = req.headers['sec-websocket-protocol']?.split(',')[0]?.trim();
    const cid = new URL(req.url, 'http://localhost').searchParams.get('cid') || undefined;
    wss.handleUpgrade(req, socket, head, (ws) => {
      gateway.handleConnection(ws, { token, cid });
    });
  });

  logger.info('[voiceGateway] voice realtime listening on /api/voice/realtime');
  return { wss, gateway };
}

module.exports = { attachVoiceGateway, REALTIME_PATH };
