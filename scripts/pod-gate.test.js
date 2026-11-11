'use strict';
/*
 * Standalone self-check for scripts/pod-gate.js: run with `node scripts/pod-gate.test.js`.
 * Boots two fake upstreams (HTTP + websocket upgrade), the gate, and asserts
 * routing follows the active-port file, flips with zero listener restart, and
 * falls back to the default port when the file is missing.
 */
const assert = require('assert');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');

const ACTIVE = path.join(require('os').tmpdir(), `gate-test-active-${process.pid}`);
const A = 31090;
const B = 31091;
const GATE = 33080;

function upstream(port, tag) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(tag);
  });
  server.on('upgrade', (req, socket, head) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\n');
    if (head && head.length) socket.write(head);
    socket.on('data', (d) => socket.write(Buffer.from(d))); // echo frames
    socket.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath }, (r) => {
      let body = '';
      r.on('data', (d) => (body += d));
      r.on('end', () => resolve({ status: r.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(new Error('timeout')); });
  });
}

function wsEcho(port) {
  return new Promise((resolve, reject) => {
    const key = Buffer.from('0123456789abcdef').toString('base64');
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(
        `GET /socket.io/?EIO=4 HTTP/1.1\r\nhost: 127.0.0.1\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-key: ${key}\r\nsec-websocket-version: 13\r\n\r\n`
      );
    });
    let buf = Buffer.alloc(0);
    let upgraded = false;
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!upgraded) {
        const s = buf.toString('latin1');
        const idx = s.indexOf('\r\n\r\n');
        if (idx >= 0) {
          assert.ok(s.startsWith('HTTP/1.1 101'), 'expected 101 upgrade, got: ' + s.slice(0, 60));
          upgraded = true;
          const rest = buf.slice(idx + 4);
          buf = Buffer.alloc(0);
          const probe = Buffer.from('ping');
          socket.write(probe);
          setTimeout(() => {
            try {
              assert.ok(buf.includes('ping'), 'upstream echo not relayed through gate');
              socket.destroy();
              resolve();
            } catch (e) {
              socket.destroy();
              reject(e);
            }
          }, 300);
          void rest;
        }
      }
    });
    socket.on('error', reject);
    socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('ws timeout')); });
  });
}

(async () => {
  await upstream(A, 'A');
  await upstream(B, 'B');
  const gateProc = require('child_process').spawn(process.execPath, [path.join(__dirname, 'pod-gate.js')], {
    env: { ...process.env, ACTIVE_PORT_FILE: ACTIVE, GATE_PORT: String(GATE), GATE_DEFAULT_PORT: String(A) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  gateProc.stderr.on('data', (d) => process.stderr.write(d));
  await new Promise((r) => setTimeout(r, 500));

  try {
    // 1. default port when file missing
    fs.rmSync(ACTIVE, { force: true });
    let r = await get(GATE, '/readyz');
    assert.deepStrictEqual([r.status, r.body], [200, 'A'], 'default-port routing');

    // 2. explicit file value
    fs.writeFileSync(ACTIVE, String(B));
    r = await get(GATE, '/readyz');
    assert.deepStrictEqual([r.status, r.body], [200, 'B'], 'flip to B');
    r = await get(GATE, '/api/x?y=1');
    assert.strictEqual(r.body, 'B', 'query string preserved');

    // 3. flip back
    fs.writeFileSync(ACTIVE, String(A));
    r = await get(GATE, '/readyz');
    assert.strictEqual(r.body, 'A', 'flip back to A');

    // 4. garbage in file falls back to default
    fs.writeFileSync(ACTIVE, 'not-a-port');
    r = await get(GATE, '/readyz');
    assert.strictEqual(r.body, 'A', 'garbage falls back to default');

    // 5. websocket upgrade relay
    fs.writeFileSync(ACTIVE, String(B));
    await wsEcho(GATE);

    console.log('pod-gate.test.js: all 5 checks passed');
  } finally {
    gateProc.kill();
  }
  process.exit(0);
})().catch((e) => {
  console.error('pod-gate.test.js FAILED:', e.message);
  process.exit(1);
});
