# Deploying Honeytree to a server

One Ubuntu VPS, Docker Compose, Caddy for automatic HTTPS. Web is served on `/`, the API on `/api`.
Files are stored in Cloudflare R2 (default) or in MinIO on the same server.

> Status: the Compose files, Caddyfile and scripts were checked with `docker compose config` and
> `deploy.sh --dry-run`, and the backup/restore scripts were run against a real PostgreSQL 16.
> They have not run on a real server yet (the development sandbox has no Docker daemon). Treat the
> first deploy as the real test and read the output of each step.

## 1. Server sizing

Start with **4 vCPU / 8 GB RAM / 80 GB SSD** (Hetzner CPX31, DigitalOcean 8 GB, or similar).

| Component                 | RAM        | Notes                                                                    |
| ------------------------- | ---------- | ------------------------------------------------------------------------ |
| ClamAV                    | ~1.5–2 GB  | loads the whole virus database; the largest single consumer              |
| PostgreSQL                | ~1.5 GB    | `shared_buffers=1GB` is set in the prod compose file                     |
| Worker                    | 0.5–1.5 GB | ffmpeg encodes use several cores; the video queue runs one job at a time |
| API + web + Redis + Caddy | ~1.5 GB    |                                                                          |

Disk is mostly Docker images, the database and the ClamAV signatures (~1 GB). Game builds and
videos live in object storage, not on the server (unless you pick MinIO, then add a volume that
fits them: 2 GB per build adds up). Add 2 GB of swap as a safety net. Upgrade to 8 vCPU / 16 GB
when video encodes queue up or the database exceeds ~20 GB.

## 2. Prepare the server (once)

```bash
# as root, on a fresh Ubuntu 24.04
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/ && chown -R deploy:deploy /home/deploy/.ssh

# SSH: keys only, no root login
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/; s/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh

# firewall: only SSH, HTTP, HTTPS (443/udp is HTTP/3)
ufw default deny incoming && ufw default allow outgoing
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
ufw enable

# automatic security updates, a little swap
apt-get update && apt-get install -y unattended-upgrades fail2ban git curl
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Install Docker Engine from Docker's apt repository
(<https://docs.docker.com/engine/install/ubuntu/>), then let the deploy user run it:

```bash
usermod -aG docker deploy
```

**Docker and the firewall:** Docker publishes ports by editing iptables directly, which bypasses
`ufw`. That is why the production compose file publishes nothing except Caddy's 80 and 443. Never add
`ports:` to postgres, redis, clamav or minio there; reach them with `docker compose exec` instead.

**Log rotation:** every service already uses `json-file` with `max-size: 10m, max-file: 5` in the
compose file. Also set the same as the default for anything else on the host:

```bash
echo '{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"5"}}' > /etc/docker/daemon.json
systemctl restart docker
```

## 3. DNS and storage

1. Point an **A (and AAAA) record** for your domain (`honeytree.example.com`) at the server.
   Caddy requests the certificate on first start; ports 80 and 443 must be reachable.
2. **Cloudflare R2** (default):
   - Create three buckets: `honeytree-private` (builds and original uploads), `honeytree-public`
     (processed images and video) and `honeytree-backups`.
   - Connect a **custom domain** to `honeytree-public` (for example `media.honeytree.example.com`).
     That URL is `S3_PUBLIC_BASE_URL`. Leave the other two buckets private.
   - Create an API token with _Object Read & Write_ for the three buckets. Its keys are
     `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`; the endpoint is
     `https://<account-id>.r2.cloudflarestorage.com`.
   - Set CORS on **`honeytree-private`**, because browsers upload straight to it with presigned
     `PUT` URLs. Edit the origin in `infra/r2-cors.json`, then paste it into the bucket's CORS policy
     (dashboard > bucket > Settings > CORS Policy). Without this, uploads fail in the browser while
     everything looks fine on the server.
   - R2 has no egress fees, which is why it is the default for game downloads.
3. **MinIO instead** (everything on one server): in `.env.production` use the MinIO block, add DNS
   records for `MEDIA_DOMAIN` and `S3_DOMAIN`, and deploy with `infra/docker-compose.minio.yml`
   (`deploy.sh` adds it automatically when `S3_ENDPOINT` starts with `http://minio`). Size the disk for
   your builds and back the `minio-data` volume up separately: the database backups do not contain files.

Storage is chosen by environment variables only; no code changes between local MinIO, production
MinIO and R2.

## 4. First deployment

```bash
# as the deploy user
sudo mkdir -p /srv/honeytree && sudo chown deploy:deploy /srv/honeytree
git clone https://github.com/egorc74/honeytree.git /srv/honeytree
cd /srv/honeytree

cp .env.production.example .env.production
chmod 600 .env.production
nano .env.production            # replace every CHANGE_ME, set the domain and storage values
# useful: openssl rand -base64 36

infra/scripts/deploy.sh --no-backup   # first deploy: there is nothing to back up yet
```

`deploy.sh` refuses to run while `CHANGE_ME` placeholders remain. Afterwards check
`https://<domain>/healthz`, then `docker compose --env-file .env.production -f infra/docker-compose.prod.yml ps`.
The first start of ClamAV downloads its signatures and can take a few minutes; builds stay in
`scanning` until it is ready, then continue by themselves.

Run `pnpm --filter @honeytree/worker check:schema` with the production `DATABASE_URL` once after
the first migration to confirm the database has everything the media plugin and worker use.

## 5. Deploying updates

```bash
cd /srv/honeytree && infra/scripts/deploy.sh
```

What it does, in order: pull the latest code (`git pull --ff-only`) → build new images (the running
site is untouched while this happens) → back up the database → run migrations with the new image
(`MIGRATE_COMMAND`) → restart `api` and wait until it is healthy → restart `worker`, `web` and
the rest → smoke-test `https://<domain>/healthz` → remove old images, keeping the last two releases.
If the new API is not healthy after the restart, it puts the previous images back and exits non-zero.

- **Downtime:** Caddy holds requests for up to 15 s while a container restarts, so a deploy shows up as
  a few slow requests rather than errors. For that to hold, migrations must be backward compatible with
  the code that is still running: add columns and tables in one release, remove or rename them in a later
  one.
- **Roll back:** `infra/scripts/deploy.sh --rollback` restarts the previously deployed images.
  Migrations are _not_ reverted; to undo data changes restore a backup (section 7).
- **Skip the pre-deploy backup:** `--no-backup`. **Preview:** `--dry-run`.
- To deploy from a container registry instead of building on the server, set `DEPLOY_MODE=pull` and
  `HONEYTREE_IMAGE_PREFIX=ghcr.io/<owner>/honeytree` in `.env.production`.

## 6. Monitoring and error tracking

- **Uptime:** use an external monitor so you hear about it when the whole server is down: UptimeRobot,
  Better Stack, or healthchecks.io. Monitor `https://<domain>/` and `https://<domain>/healthz`.
  `infra/scripts/healthcheck.sh` checks the site, API, worker and Redis from the server; run it from cron
  every 5 minutes and set `HEALTHCHECK_PING_URL` to a healthchecks.io-style heartbeat URL, which is only
  pinged when everything is fine (a missing ping raises the alert):

  ```cron
  */5 * * * * /srv/honeytree/infra/scripts/healthcheck.sh >> /var/log/honeytree-health.log 2>&1
  ```

  A self-hosted option is Uptime Kuma: `docker compose ... --profile monitoring up -d uptime-kuma`
  (listens on 127.0.0.1:3001; open it through an SSH tunnel). It cannot tell you when the server itself is down.

- **Error tracking:** create a project at <https://sentry.io> (or a self-hosted Sentry), and put its DSN
  in `SENTRY_DSN` (API and worker) and `NEXT_PUBLIC_SENTRY_DSN` (browser). The worker reports failed
  media jobs, maintenance-job failures and crashes. The API and web apps need Sentry initialised in their
  own code (Agents 1 and 2).
- **Logs:** `docker compose --env-file .env.production -f infra/docker-compose.prod.yml logs -f --tail=100 api worker`.
  Application logs are one JSON object per line.

## 7. Backups and restore

The `backup` service runs inside the compose stack:

| When                | What                                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 02:30 UTC daily     | `pg_dump --format=custom` of the whole database, verified with `pg_restore --list`, uploaded to `BACKUP_BUCKET`, backups older than 14 days deleted (never fewer than 3 kept) |
| Sunday 04:00 UTC    | **restore test**: restores the newest backup into a scratch database, checks tables and row counts, drops it. A failure shows as `FAILED` in `docker compose logs backup`     |
| Before every deploy | `deploy.sh` takes an extra backup                                                                                                                                             |

Run a backup by hand: `docker compose --env-file .env.production -f infra/docker-compose.prod.yml run --rm backup /opt/backup/backup.sh`.
Also set a lifecycle rule on the backup bucket (R2: delete after 30 days) as a second line of defence.

**Restoring after a disaster** (new server or corrupted data):

1. Get the stack up on the server (section 4), then stop everything that writes:
   `docker compose ... stop api worker web`
2. Restore the latest backup into the live database. This replaces existing objects:

   ```bash
   docker compose --env-file .env.production -f infra/docker-compose.prod.yml run --rm backup \
     /opt/backup/restore.sh latest        # prompts you to type "restore"
   # or a specific one:  .../restore.sh honeytree-20261006T023000Z.dump
   ```

3. Start the apps again: `docker compose ... up -d` and check `/healthz` and the site.

What is _not_ in the database backup: files in object storage (R2 keeps them durably; for MinIO
back up the `minio-data` volume), `.env.production` (store a copy in a password manager), and Redis
(queued jobs are lost, but `compute-scores` runs every 5 minutes and the cleanup job requeues stuck uploads).

## 8. Day-to-day

| Task                | Command (from `/srv/honeytree`, abbreviate `dc` = `docker compose --env-file .env.production -f infra/docker-compose.prod.yml`) |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Status              | `dc ps`                                                                                                                         |
| Follow logs         | `dc logs -f --tail=100 api worker`                                                                                              |
| Database shell      | `dc exec postgres psql -U honeytree honeytree`                                                                                  |
| Job queue state     | `dc exec redis redis-cli keys 'bull:*:wait'`                                                                                    |
| Restart one service | `dc restart worker`                                                                                                             |
| Disk usage          | `docker system df`                                                                                                              |
