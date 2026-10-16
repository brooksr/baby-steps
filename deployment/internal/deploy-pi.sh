#!/usr/bin/env bash
# Run from this repository after verification. Local secrets stay in .babysteps.
set -euo pipefail
cd "$(dirname "$0")/../.."
host="${BABYSTEPS_PI_TARGET:-broche@raspberrypi.local}"
release="$(git rev-parse --short HEAD)-$(date -u +%Y%m%dT%H%M%SZ)"
private="$PWD/.babysteps/operations"
mkdir -p "$private"
chmod 700 "$PWD/.babysteps" "$private"
umask 077
if [ ! -e "$private/setup-token" ]; then openssl rand -hex 32 > "$private/setup-token"; fi
if [ ! -e "$private/backup-private.pem" ]; then
  openssl req -x509 -newkey rsa:3072 -nodes -keyout "$private/backup-private.pem" \
    -out "$private/backup-public.pem" -days 3650 -subj '/CN=BabySteps Backup Recovery'
fi
test -s "$private/backup-public.pem"
node --input-type=module -e "import{readFileSync,writeFileSync}from'node:fs';import{createHash}from'node:crypto';writeFileSync('.babysteps/operations/bootstrap-token.sha256',createHash('sha256').update(readFileSync('.babysteps/operations/setup-token','utf8').trim()).digest('hex'));"
test -f dist-internal/internal-api.mjs
test -f dist-internal-web/index.html
package="$private/$release.tar.gz"
tar --exclude=deployment/internal/internal.env -czf "$package" dist-internal dist-internal-web deployment/internal public/sw.js
tar -czf "$private/$release-setup.tar.gz" -C "$private" backup-public.pem bootstrap-token.sha256
ssh -o BatchMode=yes -o ConnectTimeout=10 "$host" "umask 077; mkdir -p babysteps/internal/releases/$release"
scp -q "$package" "$private/$release-setup.tar.gz" "$host:babysteps/internal/releases/$release/"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$host" bash -s -- "$release" <<'REMOTE'
set -euo pipefail
release="$1"
cd "$HOME/babysteps/internal/releases/$release"
tar -xzf "$release.tar.gz"
tar -xzf "$release-setup.tar.gz"
bash deployment/internal/pi-install.sh "$release"
REMOTE
printf '%s\n' "$release" > "$private/deployed-release"
echo 'Setup token and backup private key are in .babysteps/operations (not uploaded).'
