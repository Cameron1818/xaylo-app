# Single VM deployment

For copy-and-paste Google Cloud infrastructure commands and the GitHub deployment flow, use [the GCP deployment guide](GCP.md).

This stack runs Xaylo, PostgreSQL 16 and Caddy on one VM. Caddy serves HTTPS; only ports 80 and 443 are published. PostgreSQL and the Node service are reachable only on Docker networks. Use this for a private Marketplace pilot, with off-VM database backups.

## Prepare the VM

1. Create a GCP Compute Engine Ubuntu VM with at least 4 GB RAM and a persistent boot disk. Reserve a static external IP. Allow inbound TCP 80 and 443 in the GCP firewall; restrict SSH to your own access path. Point an A record such as `app-test.xaylo.com` to the IP.
2. Install Docker Engine with the Compose plugin and the Google Cloud CLI. Put this project at a stable path such as `/opt/xaylo`. Ensure the deploying user can run `docker compose`.
3. Create a private GCS bucket for backups. Give the VM service account `roles/storage.objectCreator` on that bucket and the VM the `cloud-platform` access scope; GCP's default Storage scope is read-only. Set a bucket lifecycle policy and verify the first backup upload from the VM. [GCP service account scopes](https://docs.cloud.google.com/compute/docs/access/service-accounts)
4. Copy `.env.vm.example` to `.env.vm`, run `chmod 600 .env.vm`, and enter the domain and the provider credentials you want to enable. HighLevel credentials are optional for website-only deployments. Generate `POSTGRES_PASSWORD`, `ENCRYPTION_KEY`, and `SESSION_SECRET` independently with `openssl rand -hex 32`. Keep these values stable across deployments. The PostgreSQL password must be hexadecimal because Compose places it in a connection URL.

The deploy script derives `PUBLIC_BASE_URL` from `APP_DOMAIN` and forces `NODE_ENV=production` and `DEV_PREVIEW=false`. The local sample traffic and local preview sign-in are unavailable on this VM.

## Deploy or update

From the project directory:

```sh
bash deploy/deploy.sh
docker compose --env-file .env.vm -f compose.vm.yaml ps
curl --fail https://app-test.xaylo.com/health
```

`deploy.sh` starts PostgreSQL, builds the app image, runs the SQL migrations, and then starts the app and Caddy. A failed migration stops the deployment before the new app starts. Caddy obtains and renews the HTTPS certificate once DNS and ports 80/443 are working. To inspect a failure:

```sh
docker compose --env-file .env.vm -f compose.vm.yaml logs --tail=100 app caddy db
```

Keep `/health` public for a simple uptime check. Configure the HighLevel private test app with `https://APP_DOMAIN/oauth/callback`, `https://APP_DOMAIN/app`, and `https://APP_DOMAIN/webhooks/ghl`. Use its test install link to sign in; standalone email sign-in is available when Resend is configured.

## Back up PostgreSQL

Run a backup once and verify that an object appears in the bucket:

```sh
bash deploy/backup-db.sh gs://YOUR_BUCKET/xaylo
```

Schedule the same command daily using cron or a systemd timer, and monitor failures. For a checkout at `/opt/xaylo`, a crontab entry can be:

```cron
15 2 * * * cd /opt/xaylo && /usr/bin/env bash deploy/backup-db.sh gs://YOUR_BUCKET/xaylo >> "$HOME/xaylo-backup.log" 2>&1
```

Ensure the cron user's `PATH` includes both `docker` and `gcloud`, and that it can access the Docker socket. The script creates a PostgreSQL custom-format dump, uploads it to GCS, then removes the temporary local file. Do a restore rehearsal before relying on the backups. The named Docker volumes keep database and Caddy certificate data across container recreation, but a VM or disk loss requires an off-VM backup.

For a restore, download a chosen `.dump` object, stop the app, and use `pg_restore` into an empty database. Verify the restored app before reopening traffic. Keep the original `ENCRYPTION_KEY`: existing HighLevel OAuth tokens cannot be decrypted if it changes.

## VM sizing and upkeep

The 4 GB VM is a starting point that can build the image and run all three services. After measuring memory usage, you can build images in CI and run them on a smaller VM. Apply VM and Docker updates, monitor disk space and backup completion, and take a database backup before schema changes.

## Reporting, accounts and subscriptions

The Compose service forwards the optional email, Google Ads, AI and Stripe settings from `.env.vm.example`. Follow [reporting setup](../docs/reporting.md) to configure OAuth callbacks, the verified email sender, AI model, Stripe recurring Price and signed webhooks. The deployment migration step includes the new workspace references, report summaries, grants and usage counters. Back up the database before upgrading and verify email sign-in, a live source report, Stripe test checkout/webhooks, and expiry cleanup before opening registration.
