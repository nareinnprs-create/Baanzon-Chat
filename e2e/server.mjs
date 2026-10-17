/**
 * E2E stub server — serves the built client (`client/dist`) for the Playwright smoke
 * suite and the Lighthouse lane, with an SPA fallback so client-side routes resolve.
 *
 * It also answers the two API calls the unauthenticated landing surface makes, so the
 * login page renders its real form without a backend, a database, or JWT secrets:
 *
 *   GET  /api/config         -> a minimal TStartupConfig (email login enabled)
 *   POST /api/auth/refresh   -> 401, which is what settles the SPA on /login
 *
 * Every other /api request gets a JSON 404 rather than the index.html fallback, so a
 * missing stub fails as a request instead of as a parse error inside the app. This is
 * not the product server; it exists only so the browser lanes are self-contained.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const distDir = resolve(here, '..', 'client', 'dist');
const port = Number(process.env.PORT || 3080);
const host = process.env.HOST || '127.0.0.1';

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Only the fields the login surface reads; the type is elsewhere and not enforced at runtime. */
const startupConfig = {
  appTitle: 'Baanzon Chat',
  socialLogins: [],
  emailLoginEnabled: true,
  emailEnabled: false,
  registrationEnabled: false,
  socialLoginEnabled: false,
  passwordResetEnabled: false,
  discordLoginEnabled: false,
  facebookLoginEnabled: false,
  githubLoginEnabled: false,
  googleLoginEnabled: false,
  openidLoginEnabled: false,
  appleLoginEnabled: false,
  samlLoginEnabled: false,
  openidLabel: '',
  openidImageUrl: '',
  openidAutoRedirect: false,
  samlLabel: '',
  samlImageUrl: '',
  serverDomain: `http://${host}:${port}`,
  showBirthdayIcon: false,
  helpAndFaqURL: '',
  sharedLinksEnabled: false,
  publicSharedLinksEnabled: false,
  allowAccountDeletion: false,
};

const indexHtml = join(distDir, 'index.html');

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendFile(res, filePath) {
  const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type });
  createReadStream(filePath).pipe(res);
}

function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { message: 'Method not allowed' });
    return;
  }

  const pathname = decodeURIComponent(new URL(req.url, `http://${host}:${port}`).pathname);

  if (pathname === '/api/config' || pathname === '/api/config/') {
    sendJson(res, 200, startupConfig);
    return;
  }
  if (pathname === '/api/auth/refresh') {
    sendJson(res, 401, { message: 'Unauthorized' });
    return;
  }
  if (pathname.startsWith('/api/')) {
    sendJson(res, 404, { message: 'Not found' });
    return;
  }

  const candidate = normalize(join(distDir, pathname));
  if (!candidate.startsWith(distDir)) {
    sendJson(res, 403, { message: 'Forbidden' });
    return;
  }
  if (existsSync(candidate) && statSync(candidate).isFile()) {
    sendFile(res, candidate);
    return;
  }
  if (extname(pathname) !== '') {
    sendJson(res, 404, { message: 'Not found' });
    return;
  }
  sendFile(res, indexHtml);
}

if (!existsSync(indexHtml)) {
  console.error(`e2e stub server: ${indexHtml} is missing — run \`npm run build:client\` first.`);
  process.exit(1);
}

createServer(handle).listen(port, host, () => {
  console.log(`e2e stub server listening on http://${host}:${port} (serving ${distDir})`);
});
