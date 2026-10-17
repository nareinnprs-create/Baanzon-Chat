# Deployment

Baanzon Chat ships through a **gated continuous-deployment pipeline** defined
in `.github/workflows/release.yml` (P6.5). Three ideas define it:

1. **Releases are version tags** (`v*`), not branch pushes — pushing to `b1`,
   `dev` or `main` deploys nothing.
2. **A human approves every deploy** through the GitHub `production`
   environment. The workflow references the environment; the approval rules
   live in repository settings.
3. **"Deploy" means pushing the one image `deploy-compose.yml` builds**
   (`Dockerfile.multi`, target `api-build` → `baanzon-chat-api`). Servers are
   provisioned and restarted by hand — see [Not automated](#not-automated).

## What runs, and when

| Trigger                                   | `build` job                        | `deploy` job                                         |
| ----------------------------------------- | ---------------------------------- | ---------------------------------------------------- |
| Tag push `v*` (`v1.2.3`, `v1.2.3-rc.1`)   | runs                               | runs — **waits for approval**, then pushes the image |
| `workflow_dispatch` (Run workflow button) | runs                               | **skipped** (tag guard in its `if:`)                 |
| Push to `b1` / `dev` / `main`             | — (this workflow does not trigger) | —                                                    |
| Pull request                              | — (this workflow does not trigger) | —                                                    |

Tag pushes do **not** trigger the branch workflows either — their
`push.branches` filters do not match tags — so the `build` job is the only CI
at the tagged commit. It re-runs, at the exact release commit, the checks the
commit already passed on its pull request:

| Step               | Script (root `package.json`)                                                                       | Same as                                 |
| ------------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Workspace packages | `npm run build:packages`                                                                           | `build.yml`                             |
| Client bundle      | `npm run build:client`                                                                             | `build.yml`                             |
| Types, 6 projects  | `npx tsc --noEmit -p <project>/tsconfig.json` (+ `tsconfig.test.json` for `packages/client` specs) | `typecheck.yml`                         |
| API suite          | `npm run test:api` (`cd api && npm run test:ci`)                                                   | `test.yml` (its env prep step included) |

The other six Jest suites stay in `test.yml`/`integration.yml` and run per pull
request; the release job does not repeat them.

Branch wiring is deliberate: the pipeline is tag-triggered, so it is agnostic
to the `b1`/`dev`/`main` layout. There is no "deploys from `main` only" rule —
a tag cut from any commit is a release of that commit.

## The approval gate

The `deploy` job declares:

```yaml
environment: production
```

GitHub holds the job at that point until someone with approval rights accepts
it. The mechanics:

1. **One-time setup (repository admin):** Settings → Environments →
   **New environment** → name it `production` → enable **Required reviewers**
   and pick the approvers. The environment is auto-created _without_ protection
   rules on the first run that references it, so a run that reaches the deploy
   job before this setup **deploys unattended**. Configuring the reviewers is
   part of the rollout, not an optional extra.
2. **Per release:** on the run page the `deploy` job shows
   _Waiting for a reviewer_ → a reviewer opens it → **Review deployments** →
   select `production` → **Approve**. The image push runs only after that.
3. **Optional hardening:** on the same environment page,
   _Deployment branches and tags_ can restrict which refs may deploy (e.g.
   limit to tags matching `v*`), and _Wait timer_ can add a cool-down.

Because the approval gate is environment-scoped, everything gated behind it —
including the registry secrets stored on the environment — is invisible to the
`build` job and to pull-request workflows.

## Required secrets

All three are read by the `deploy` job only. The job **skips the image push
cleanly (green, with a notice) if any is missing** — no registry configured is a
no-op, never a failure — so the workflow can be merged before a registry exists.

| Secret              | Value                                                                                   | Example                                                          |
| ------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `REGISTRY`          | Registry host **plus** namespace prefix; the image becomes `$REGISTRY/baanzon-chat-api` | `ghcr.io/your-org` or `registry.example.com/team`                |
| `REGISTRY_USERNAME` | Registry user or token owner                                                            | `your-bot`                                                       |
| `REGISTRY_PASSWORD` | Registry token with push/write scope                                                    | PAT with `write:packages` (GHCR) or an access token (Docker Hub) |

**Where to set them:** Settings → Secrets and variables → Actions. Storing them
as **environment secrets on `production`** (the environment tab's _Secrets_
section) is recommended: they are then exposed only to the approved `deploy`
job. Repository secrets also work but are visible to every workflow. A secret of
the same name on the environment overrides the repository one for this job.

Notes:

- For GitHub Container Registry, `REGISTRY=ghcr.io/your-org` and the password
  must be a PAT with `write:packages` — the workflow pushes with the explicit
  secrets, not with `GITHUB_TOKEN`, so a PAT (or equivalent) is required even
  though the job holds `packages: write`.
- The login step authenticates against the host before the first `/` in
  `REGISTRY` (`ghcr.io/your-org` logs in to `ghcr.io`), so a namespace prefix in
  `REGISTRY` is safe.

## How to trigger a release

```bash
git checkout dev        # or b1 — the tag is what matters, not the branch
git pull
git tag v0.9.0          # must start with `v` (the trigger pattern is `v*`)
git push origin v0.9.0
```

Then: **Actions → Release → the new run** → the `build` job runs
(≈15–45 min) → approve the `deploy` job (see [the gate](#the-approval-gate)) →
the image is pushed as:

```
$REGISTRY/baanzon-chat-api:v0.9.0   # immutable version tag
$REGISTRY/baanzon-chat-api:latest   # floating tag, matches deploy-compose.yml
```

**Verification run:** _Run workflow_ (manual dispatch) executes the `build` job
on a branch of your choice and stops before deploying — useful as a release
preflight. The dispatch button appears only once `release.yml` exists on the
default branch (`main`); tag pushes need no such merge and run the workflow
definition as of the tagged commit.

## Rollback

Images are never deleted by this pipeline: every release stays in the registry
under its `vX.Y.Z` tag, so there is always a version to roll back to.

**Re-publish a known-good build** (registry scope — automated apart from the
approval): Actions → Release → the run of the last good tag → **Re-run all
jobs** → approve. It rebuilds at that tag and pushes both `:vX.Y.Z` and
`:latest`, flipping `latest` back to the good build.

**Roll the running service back** (manual — see
[Not automated](#not-automated)). The host has to run the previous image
instead of the one just deployed; with compose that is an override file that
disables the local build and pins the image:

```yaml
# rollback-override.yml, on the host
services:
  api:
    build: !reset null
    image: REGISTRY/baanzon-chat-api:vX.Y.Z-1 # the previous release
```

```bash
docker pull REGISTRY/baanzon-chat-api:vX.Y.Z-1
docker compose -f deploy-compose.yml -f rollback-override.yml up -d api
```

(If a host builds from source rather than pulling pushed images, roll back the
source instead: check out the previous tag and rebuild.)

For a defect discovered after release, prefer fix-forward — cut a new `v*` tag —
over re-running history. Released tags are never moved.

## Not automated

This pipeline ends at the registry. The following are **manual** and are not
attempted (and must not be invented in the workflow):

- **Server provisioning** — VMs, Docker installation, firewall, storage. No
  infrastructure-as-code exists in this repository.
- **Rolling the running service** — `docker compose pull/up` on hosts, restarts,
  health verification after a deploy.
- **DNS, TLS, reverse proxy / load balancer** configuration.
- **Database migrations** — the `npm run migrate:*` scripts (root `package.json`)
  run by hand against the target database.
- **Registry lifecycle** — creating the registry, retention/GC policies.
  The pipeline only pushes.
- **One-time GitHub setup** — creating the `production` environment, its required
  reviewers, and the three registry secrets.
- **The GitHub `production` environment is a GitHub concept only** — it maps to
  no provisioned environment in this repository.

## Validating workflow changes

Do not run workflows locally. YAML-parse new or edited files instead — `js-yaml`
is already in the dev tree:

```bash
node -e "require('js-yaml').load(require('fs').readFileSync(process.argv[1], 'utf8')); console.log('OK')" .github/workflows/release.yml
```
