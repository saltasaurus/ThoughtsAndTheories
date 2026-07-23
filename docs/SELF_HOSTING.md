# Self-hosting TheoryTracker

Three supported paths. All of them need a real `AUTH_SECRET` — generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

The app **refuses to serve the dev default** (`dev-only-do-not-deploy`) once
`AUTH_URL` points anywhere but localhost. If a misconfigured instance shows
"Something went wrong" on every request, check the server logs for the secret
guard — Next redacts the real message in production.

---

## A. VPS with Docker Compose + Caddy (primary path)

1. **Provision** a small VPS (1–2 GB RAM is plenty) with Docker installed.
2. **DNS**: point an A/AAAA record for your domain (e.g. `club.example.com`) at
   the VPS.
3. **Clone & configure**:
   ```bash
   git clone https://github.com/saltasaurus/theorytracker.git && cd theorytracker
   cp .env.example .env
   # edit .env:
   #   AUTH_SECRET=<paste the generated value>
   #   DOMAIN=club.example.com
   #   AUTH_URL=https://club.example.com
   ```
4. **Launch** (Caddy obtains HTTPS automatically for `$DOMAIN`):
   ```bash
   docker compose --profile prod up -d --build
   ```
   The `migrate` service runs `prisma migrate deploy` before the app starts.
5. **Bootstrap**: visit `https://club.example.com` — with an empty database
   you're prompted to create the first (owner) account. Do this immediately;
   until you do, anyone who reaches the app can claim it. Registration closes
   behind that first account.

> **Do not seed a production instance.** The demo seed creates accounts with a
> published password and makes one of them an OWNER. The seed refuses to run
> under `NODE_ENV=production` for exactly this reason.

## B. Home server behind Cloudflare Tunnel or Tailscale

Run the same prod profile without exposing ports 80/443:

- **Cloudflare Tunnel**: `cloudflared tunnel create theorytracker`, route your
  hostname to `http://localhost:3000`, and run the `app` + `db` services only
  (skip Caddy; the tunnel terminates TLS). Set `AUTH_URL` to the tunnel
  hostname — **not** localhost, or the secret guard fires and remote logins
  break.
- **Tailscale**: install Tailscale on the server, `tailscale serve 3000`, and
  share the tailnet with your club.
  `AUTH_URL=https://<machine>.<tailnet>.ts.net`.

## C. Vercel + managed Postgres

No Compose involved. Create a managed Postgres (Neon, Supabase, Vercel
Postgres), then in the Vercel project set `DATABASE_URL` (from the provider),
`AUTH_SECRET`, and `AUTH_URL` (your Vercel URL). Run `npx prisma migrate deploy`
against the database once (locally or via CI). Everything else is unchanged —
the app is a standard Next.js deployment.

---

## Upgrading

The prod image builds locally and `migrate` runs on the way up, so an upgrade is:

```bash
docker compose --profile prod exec db \
  pg_dump -U theorytracker theorytracker > backup-before-upgrade.sql   # 1. back up first
git pull                                                               # 2. new code
docker compose --profile prod up -d --build                            # 3. rebuild + migrate + restart
```

Do not maintain a local diff against tracked files (e.g. the compose password) —
step 2 will conflict on every upgrade. See below for why that isn't necessary.

## The Postgres password is not the security boundary — the loopback bind is

The compose file ships `theorytracker:theorytracker` as the database password,
hardcoded in tracked files and reused by the test suite. That's fine, and you
should **not** change it: the database binds `127.0.0.1:5432`, so it is not
reachable from outside the host at all.

Note that **Docker bypasses the host firewall**. A published port inserts NAT
rules *ahead* of the `INPUT` chain, so `ufw deny 5432` never blocked a `0.0.0.0`
bind — the loopback bind in `docker-compose.yml` is what actually closes it. If
you must reach Postgres from another machine, use an SSH tunnel
(`ssh -L 5432:127.0.0.1:5432 user@host`), never a `0.0.0.0` publish.

## Backups

A nightly `pg_dump` via cron (`crontab -e`):

```cron
0 3 * * * docker compose -f /path/to/theorytracker/docker-compose.yml --profile prod exec -T db pg_dump -U theorytracker theorytracker | gzip > /var/backups/theorytracker-$(date +\%F).sql.gz
```

Restore:

```bash
gunzip -c backup.sql.gz | docker compose --profile prod exec -T db psql -U theorytracker theorytracker
```

**Treat these dumps as sensitive.** A dump contains every bcrypt password hash
and every private wiki in plaintext SQL. As written above it lands unencrypted,
under the default umask, on the same host as the database — so at minimum:

- restrict the directory: `install -d -m 700 /var/backups`;
- rotate old dumps so they don't accumulate forever;
- for anything beyond a hobby instance, encrypt at rest (e.g. pipe through `age`
  or `gpg`) and copy off-host, so a single compromised VPS isn't also the only
  copy of your backups.
