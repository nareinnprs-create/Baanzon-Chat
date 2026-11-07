#!/bin/bash
# One-time pod provision for Baanzon Chat (Ubuntu 22.04 CPU pod, everything native).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg supervisor jq rsync git

# ---- Node 24 (matches .nvmrc 24.16.0) ----
if ! command -v node >/dev/null || [ "$(node -v | cut -c2.)" != 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs
fi

# MongoDB Database Tools (mongodump for backups)
echo "Installing MongoDB Database Tools..."
curl -fsSL -o /tmp/mtools.deb "https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2204-x86_64-100.10.0.deb" 2>/dev/null
dpkg -i /tmp/mtools.deb > /dev/null 2>&1 || true

# SearXNG search engine (for web search in agents)
if [ ! -d /opt/searxng-src ]; then
  git clone --depth 1 https://github.com/searxng/searxng /opt/searxng-src 2>/dev/null
  pip install -q -r /opt/searxng-src/requirements.txt 2>/dev/null
  pip install -q --ignore-installed blinker 2>/dev/null
  pip uninstall -y -q searxng 2>/dev/null
  mkdir -p /etc/searxng
  printf 'use_default_settings: true\nserver:\n  secret_key: "baanzon-searxng-2026"\n  limiter: false\n  port: 8888\n  bind_address: "127.0.0.1"\nsearch:\n  formats:\n    - html\n    - json\n' > /etc/searxng/settings.yml
fi

# Cron for nightly backups
apt-get install -y -qq cron > /dev/null 2>&1 || true
echo "node: $(node -v)"

# ---- MongoDB server 8.0 (binary tarball; avoids apt repo roundtrips) ----
if ! command -v mongod >/dev/null; then
  cd /tmp
  curl -fsSL https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2204-8.0.20.tgz -o mongo.tgz
  tar -xzf mongo.tgz
  install -m755 mongodb-linux-x86_64-*/bin/mongod /usr/local/bin/mongod
  install -m755 mongodb-linux-x86_64-*/bin/mongosh /usr/local/bin/mongosh || true
  rm -f mongo.tgz
fi
echo "mongod: $(mongod --version | head -1)"

# ---- Meilisearch 1.35.1 ----
if ! command -v meilisearch >/dev/null; then
  curl -fsSL "https://install.meilisearch.com" | sh >/dev/null 2>&1
  install -m755 /tmp/meilisearch /usr/local/bin/meilisearch 2>/dev/null || install -m755 meilisearch /usr/local/bin/meilisearch || true
fi
echo "meili: $(meilisearch --version 2>/dev/null || echo MISSING)"

# ---- cloudflared ----
if ! command -v cloudflared >/dev/null; then
  curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
  chmod +x /usr/local/bin/cloudflared
fi
echo "cloudflared: $(cloudflared --version)"

# ---- supervisor config ----
cat >/etc/supervisor/conf.d/baanzon.conf <<'EOF'
[program:mongod]
command=/usr/local/bin/mongod --dbpath /workspace/data/mongodb --bind_ip 127.0.0.1 --wiredTigerCacheSizeGB 0.4
directory=/workspace/baanzon
autostart=true
autorestart=true
stopasgroup=true
stdout_logfile=/workspace/baanzon/logs/supervisor-mongod.log
redirect_stderr=true

[program:meilisearch]
command=/bin/bash -lc 'set -a; source /workspace/baanzon/.env; exec meilisearch --db-path /workspace/data/meili_data --http-addr 0.0.0.0:7700 --no-analytics'
directory=/workspace/baanzon
autostart=true
autorestart=true
stopasgroup=true
stdout_logfile=/workspace/baanzon/logs/supervisor-meili.log
redirect_stderr=true

[program:searxng]
command=gunicorn -b 127.0.0.1:8888 searx.webapp:app
directory=/opt/searxng-src
environment=SEARXNG_SETTINGS_PATH="/etc/searxng/settings.yml",PYTHONPATH="/opt/searxng-src"
autostart=true
autorestart=true
stdout_logfile=/workspace/baanzon/logs/searxng.log
redirect_stderr=true

[program:baanzon-api]
command=/bin/bash -lc 'set -a; source /workspace/baanzon/.env; exec node api/server/index.js'
directory=/workspace/baanzon
autostart=true
autorestart=true
stopasgroup=true
environment=NODE_ENV="production"
stdout_logfile=/workspace/baanzon/logs/supervisor-api.log
redirect_stderr=true

[program:cloudflared]
command=/bin/bash -lc 'set -a; source /workspace/baanzon/.env; exec cloudflared tunnel run --token $TUNNEL_TOKEN'
directory=/workspace/baanzon
autostart=true
autorestart=true
stopasgroup=true
stdout_logfile=/workspace/baanzon/logs/supervisor-tunnel.log
redirect_stderr=true
EOF

mkdir -p /workspace/data/mongodb /workspace/data/meili_data /workspace/baanzon/logs /workspace/baanzon/images /workspace/baanzon/uploads
supervisorctl reread && supervisorctl update || true
echo "PROVISION COMPLETE"
supervisorctl status || true
