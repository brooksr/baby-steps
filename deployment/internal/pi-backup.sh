#!/usr/bin/env bash
# Runs as the Pi's Docker-enabled user. Only the PUBLIC encryption cert is here.
set -euo pipefail
umask 077
root="${BABYSTEPS_INTERNAL_ROOT:-$HOME/babysteps/internal}"
mkdir -p "$root/backups"
exec 9>"$root/.backup.lock"
flock -n 9 || exit 0
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
inside="/var/lib/babysteps/.backup-${stamp}.sqlite"
plain="$root/backups/.backup-${stamp}.sqlite"
encrypted="$root/backups/backup-${stamp}.cms"
cleanup() { rm -f "$plain" "$encrypted.incoming"; docker exec babysteps-internal rm -f "$inside" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker exec babysteps-internal node internal-tool.mjs backup --database /var/lib/babysteps/internal.sqlite --destination "$inside"
docker exec babysteps-internal node internal-tool.mjs restore-check --database "$inside"
docker cp "babysteps-internal:$inside" "$plain"
chmod 600 "$plain"
openssl cms -encrypt -binary -aes-256-gcm -in "$plain" -outform DER -out "$encrypted.incoming" "$root/backup-public.pem"
mv "$encrypted.incoming" "$encrypted"
printf '%s\n' "$stamp" > "$root/last-backup-success"
echo "Encrypted backup ready: $encrypted"
# Retention is deliberately explicit: keep all snapshots until household policy
# is agreed. Monitor disk space; a full disk is an operational failure.
