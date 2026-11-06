# Deploy Xaylo from GitHub to Google Cloud

Run the infrastructure commands in **Google Cloud Shell**. This uses a single Ubuntu 24.04 VM in London with 4 GB RAM, a 30 GB persistent boot disk, a static IP, HTTPS through Caddy, PostgreSQL on an internal Docker network, and private off-VM backups. The VM, disk, address and bucket are billable resources. Use an existing Google Cloud project with billing enabled and an administrator account that can create resources and grant IAM roles.

The source repository is `https://github.com/Cameron1818/xaylo-app.git`. These commands do not configure GitHub Actions; you deploy updates by pulling the repository on the VM and running the deploy script.

## 1. Set your project

Replace the project ID below. A project ID is not the project's display name or numeric project number.

```sh
export XAYLO_PROJECT='YOUR_PROJECT_ID'
export XAYLO_REGION='europe-west2'
export XAYLO_ZONE='europe-west2-b'
export XAYLO_VM='xaylo-vm'
export XAYLO_SA="xaylo-vm@${XAYLO_PROJECT}.iam.gserviceaccount.com"
export XAYLO_BUCKET="${XAYLO_PROJECT}-xaylo-backups"
export XAYLO_USER="$(gcloud config get-value account)"

gcloud config set project "$XAYLO_PROJECT"
gcloud services enable compute.googleapis.com iam.googleapis.com iap.googleapis.com oslogin.googleapis.com storage.googleapis.com
```

The IAM commands below assume your active account is a human Google account. If an organisation manages your permissions, have its administrator grant the listed roles instead.

## 2. Create the network, service account and VM

Run each create command once. If a resource already exists, inspect it and resume from the next unfinished step instead of deleting it.

```sh
gcloud compute networks create xaylo-vpc --subnet-mode=custom
gcloud compute networks subnets create xaylo-subnet \
  --network=xaylo-vpc --region="$XAYLO_REGION" --range=10.42.0.0/24

gcloud compute firewall-rules create xaylo-web \
  --network=xaylo-vpc --direction=INGRESS --action=ALLOW \
  --rules=tcp:80,tcp:443,udp:443 --source-ranges=0.0.0.0/0 --target-tags=xaylo-web

gcloud compute firewall-rules create xaylo-iap-ssh \
  --network=xaylo-vpc --direction=INGRESS --action=ALLOW \
  --rules=tcp:22 --source-ranges=35.235.240.0/20 --target-tags=xaylo-ssh

gcloud iam service-accounts create xaylo-vm --display-name='Xaylo VM backups'
gcloud projects add-iam-policy-binding "$XAYLO_PROJECT" \
  --member="user:$XAYLO_USER" --role=roles/iap.tunnelResourceAccessor --condition=None
gcloud projects add-iam-policy-binding "$XAYLO_PROJECT" \
  --member="user:$XAYLO_USER" --role=roles/compute.osAdminLogin --condition=None
gcloud iam service-accounts add-iam-policy-binding "$XAYLO_SA" \
  --member="user:$XAYLO_USER" --role=roles/iam.serviceAccountUser

gcloud compute addresses create xaylo-ip --region="$XAYLO_REGION"
export XAYLO_IP="$(gcloud compute addresses describe xaylo-ip --region="$XAYLO_REGION" --format='value(address)')"

gcloud compute instances create "$XAYLO_VM" \
  --zone="$XAYLO_ZONE" --machine-type=e2-medium \
  --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-balanced --no-boot-disk-auto-delete \
  --network=xaylo-vpc --subnet=xaylo-subnet --address="$XAYLO_IP" \
  --tags=xaylo-web,xaylo-ssh --metadata=enable-oslogin=TRUE \
  --service-account="$XAYLO_SA" --scopes=cloud-platform

echo "Create your DNS A record pointing to: $XAYLO_IP"
```

This VPC opens SSH only through Google's IAP address range. App port 3000 and PostgreSQL port 5432 are not exposed. The boot disk is retained if the VM is deleted; it does not replace database backups.

## 3. Create the backup bucket

```sh
gcloud storage buckets create "gs://$XAYLO_BUCKET" \
  --location="$XAYLO_REGION" --uniform-bucket-level-access --public-access-prevention

gcloud storage buckets add-iam-policy-binding "gs://$XAYLO_BUCKET" \
  --member="serviceAccount:$XAYLO_SA" --role=roles/storage.objectCreator
```

The VM service account can create backups only in that bucket. Its `cloud-platform` scope allows the Google CLI to use the IAM permission; no service account key file is needed. Configure the 30-day lifecycle after you have cloned the source on the VM in step 6. Bucket soft-delete settings can retain deleted backups for an additional period.

## 4. Point DNS and connect to the VM

Create an A record such as `app.xaylo.com` pointing to the reserved IP. Keep any existing website records as they are; use the chosen app subdomain. Remove a stale AAAA record for that same hostname if it points to a different server. Caddy needs the domain to resolve to this VM before it can obtain its HTTPS certificate.

```sh
gcloud compute ssh "$XAYLO_VM" --zone="$XAYLO_ZONE" --tunnel-through-iap
```

The remaining commands run **inside the VM** until the final Cloud Shell verification step.

## 5. Clone the repository and install the runtime

```sh
sudo apt-get update
sudo apt-get install -y git
sudo install -d -o "$USER" -g "$(id -gn)" /opt/xaylo
```

For a **public repository**:

```sh
git clone https://github.com/Cameron1818/xaylo-app.git /opt/xaylo
```

For a **private repository**, create a read-only deploy key on the VM:

```sh
install -m 700 -d "$HOME/.ssh"
ssh-keygen -t ed25519 -C xaylo-vm -f "$HOME/.ssh/xaylo_deploy" -N ''
cat "$HOME/.ssh/xaylo_deploy.pub"
```

Add that public key under GitHub repository **Settings → Deploy keys**, leaving write access disabled. Do not overwrite an existing deploy key when repeating setup. Then:

```sh
git -c core.sshCommand="ssh -i $HOME/.ssh/xaylo_deploy -o IdentitiesOnly=yes" \
  clone git@github.com:Cameron1818/xaylo-app.git /opt/xaylo
cd /opt/xaylo
git config core.sshCommand "ssh -i $HOME/.ssh/xaylo_deploy -o IdentitiesOnly=yes"
```

Verify GitHub's host-key prompt using its official fingerprint documentation on the first connection. Both repository choices continue with:

```sh
cd /opt/xaylo
bash deploy/install-vm.sh
bash deploy/init-vm-env.sh app.xaylo.com
nano .env.vm
```

Replace `app.xaylo.com` with the actual domain you configured in DNS. The initializer creates new independent PostgreSQL, encryption and session secrets with file mode 0600. It refuses to overwrite an existing `.env.vm`. Keep the encryption key and database password stable across deployments, and keep a secure copy of the environment configuration for recovery. Never commit `.env.vm` or copy the local development `.env` to production.

For an initial website-only launch, set these provider settings in `.env.vm`:

| Setting | Required for |
| --- | --- |
| `RESEND_API_KEY`, `EMAIL_FROM` | Standalone account creation and sign-in; verify the sender domain in Resend |
| `OPENAI_API_KEY`, `AI_MODEL` | AI report generation |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CLOUD_PROJECT` | Live Google Ads connections |
| `GHL_CLIENT_ID`, `GHL_CLIENT_SECRET`, `GHL_SHARED_SECRET`, `GHL_APP_ID` | Optional GHL integration; leave all four empty until configured |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID` | Optional subscription checkout; begin with Stripe test mode |

The public guide, app shell and tracking service can start with optional integrations empty. Real user sign-in needs Resend or a configured GHL installation. There is no production preview bypass. Follow [reporting setup](../docs/reporting.md) for source permissions and provider configuration.

## 6. Deploy and start backups

```sh
cd /opt/xaylo
sudo bash deploy/deploy.sh
sudo docker compose --env-file .env.vm -f compose.vm.yaml ps
curl --fail https://app.xaylo.com/health
```

Use your actual hostname. The deploy script builds the app, runs migrations, and starts Xaylo, PostgreSQL and Caddy. PostgreSQL and HTTPS certificate state use persistent Docker volumes. The production Compose configuration sets `NODE_ENV=production` and disables local preview. Do not seed sample traffic on this VM.

Set the bucket name to the one created in Cloud Shell:

```sh
export XAYLO_BUCKET='YOUR_PROJECT_ID-xaylo-backups'
sudo bash deploy/backup-db.sh "gs://$XAYLO_BUCKET/xaylo"
```

The lifecycle update requires a bucket administrator. In **Cloud Shell**, run:

```sh
printf '%s\n' '{"rule":[{"action":{"type":"Delete"},"condition":{"age":30}}]}' > /tmp/xaylo-backup-lifecycle.json
gcloud storage buckets update "gs://$XAYLO_BUCKET" --lifecycle-file=/tmp/xaylo-backup-lifecycle.json
```

The VM service account intentionally has only object creation permission. Do not expand its permissions to administer the bucket.

Install the daily backup schedule on the VM:

```sh
printf '15 2 * * * root cd /opt/xaylo && /usr/bin/bash deploy/backup-db.sh gs://%s/xaylo >> /var/log/xaylo-backup.log 2>&1\n' "$XAYLO_BUCKET" | sudo tee /etc/cron.d/xaylo-backup >/dev/null
sudo chmod 644 /etc/cron.d/xaylo-backup
```

Verify the uploaded backup from **Cloud Shell**:

```sh
gcloud storage ls "gs://$XAYLO_BUCKET/xaylo/"
```

Confirm a restore to an isolated database before relying on backups. The backup archive needs the original `ENCRYPTION_KEY` to make restored OAuth credentials usable. Monitor `/var/log/xaylo-backup.log`, container health, disk space, and backup creation failures.

## 7. Configure callback URLs

Replace the hostname in these URLs:

- Website / guide: `https://app.xaylo.com/`
- Dashboard / email-link destination: `https://app.xaylo.com/app`
- Google OAuth callback: `https://app.xaylo.com/oauth/google/callback`
- GHL OAuth callback: `https://app.xaylo.com/oauth/callback`
- GHL custom page: `https://app.xaylo.com/app`
- GHL webhook: `https://app.xaylo.com/webhooks/ghl`
- Stripe webhook: `https://app.xaylo.com/webhooks/stripe`
- Client MCP connection: `https://app.xaylo.com/mcp`

Verify email sign-in, one report, both clients' data isolation, and each enabled integration before inviting users. Subscription activation must come from verified Stripe webhooks, rather than the checkout success redirect.

## Later updates

SSH through IAP, then:

```sh
cd /opt/xaylo
sudo bash deploy/backup-db.sh "gs://YOUR_PROJECT_ID-xaylo-backups/xaylo"
git pull --ff-only origin main
sudo bash deploy/deploy.sh
```

Migration failure stops deployment before the new application starts. Never run `docker compose down -v` against production; that deletes the database volumes. Read container logs with:

```sh
sudo docker compose --env-file .env.vm -f compose.vm.yaml logs --tail=100 app caddy db
```

References: [GCP VM creation](https://docs.cloud.google.com/compute/docs/instances/create-start-instance), [IAP SSH](https://docs.cloud.google.com/iap/docs/using-tcp-forwarding), [VM service accounts](https://docs.cloud.google.com/compute/docs/access/create-enable-service-accounts-for-instances), [private buckets](https://docs.cloud.google.com/storage/docs/creating-buckets), [Docker on Ubuntu](https://docs.docker.com/engine/install/ubuntu/), [Google Cloud CLI](https://docs.cloud.google.com/sdk/docs/install-sdk).
