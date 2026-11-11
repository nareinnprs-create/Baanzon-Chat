#!/usr/bin/env node
/*
 * Blue-green gate for the pod. Owns 127.0.0.1:3080 (the port cloudflared
 * forwards to) for the life of the pod and never restarts during deploys.
 * Every request is forwarded to the port named in ACTIVE_PORT_FILE, so a
 * deploy flips traffic by writing one file - the old release keeps serving
 * until the new one passes its health gate.
 * Zero dependencies: http proxy + websocket upgrade passthrough.
 */
'use strict';

const http = require('http');
const fs = require('fs');

const ACTIVE = process.env.ACTIVE_PORT_FILE || '/workspace/data/active-port';
const LISTEN = Number(process.env.GATE_PORT || 3080);
const DEFAULT_PORT = Number(process.env.GATE_DEFAULT_PORT || 3090);
const agent = new http.Agent({ keepAlive: true, maxSockets: 200 });

function active() {
  try {
    const p = parseInt(fs.readFileSync(ACTIVE, 'utf8').trim(), 10);
    return p > 0 && p < 65536 ? p : DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

const server = http.createServer((req, res) => {
  const upstream = http.request(
    { host: '127.0.0.1', port: active(), path: req.url, method: req.method, headers: req.headers, agent },
    (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res, { end: true });
    }
  );
  upstream.on('error', () => {
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader('content-type', 'text/plain');
      res.end('gate: api upstream unavailable');
    } else {
      res.destroy();
    }
  });
  req.pipe(upstream, { end: true });
});

// socket.io websocket upgrades: raw socket passthrough after 101
server.on('upgrade', (req, client, head) => {
  const upstream = http.request({ host: '127.0.0.1', port: active(), path: req.url, method: req.method, headers: req.headers, agent });
  upstream.on('upgrade', (r, up, uhead) => {
    const lines = [`HTTP/${r.httpVersion} ${r.statusCode} ${r.statusMessage}`];
    for (const [k, v] of Object.entries(r.headers)) lines.push(`${k}: ${v}`);
    client.write(lines.join('\r\n') + '\r\n\r\n');
    if (uhead && uhead.length) client.write(uhead);
    up.pipe(client);
    client.pipe(up);
    const die = () => { up.destroy(); client.destroy(); };
    up.on('error', die);
    client.on('error', die);
    client.on('close', () => up.destroy());
    up.on('close', () => client.destroy());
  });
  upstream.on('response', (r) => {
    // upstream refused the upgrade; relay the plain response
    const lines = [`HTTP/${r.httpVersion} ${r.statusCode} ${r.statusMessage}`];
    for (const [k, v] of Object.entries(r.headers)) lines.push(`${k}: ${v}`);
    client.end(lines.join('\r\n') + '\r\n\r\n');
  });
  upstream.on('error', () => client.destroy());
  if (head && head.length) upstream.write(head);
  upstream.end();
});

server.headersTimeout = 0; // long-lived LLM streams
server.requestTimeout = 0;
server.keepAliveTimeout = 65000;
server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(LISTEN, '127.0.0.1', () => {
  console.log(`[gate] listening 127.0.0.1:${LISTEN} -> port from ${ACTIVE} (default ${DEFAULT_PORT})`);
});
