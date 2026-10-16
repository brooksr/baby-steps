#!/usr/bin/env bash
# Invoked over SSH by deploy-pi.sh. No sudo, Compose or changes to legacy writers.
set -euo pipefail
release="${1:?release id required}"
[[ "$release" =~ ^[a-zA-Z0-9-]+$ ]] || exit 1
root="$HOME/babysteps/internal"
source="$root/releases/$release"
www="$HOME/babysteps/www/internal"
mkdir -p "$root/backups" "$root/rollbacks" "$www/releases"
chmod 700 "$root" "$root/backups" "$root/rollbacks"
chmod 755 "$HOME/babysteps/www" "$www" "$www/releases"
if [ -e "$root/backup-public.pem" ] && ! cmp -s "$source/backup-public.pem" "$root/backup-public.pem"; then
  echo 'Backup recipient changed: recover the existing private key before deployment.' >&2; exit 1
fi
cp "$source/backup-public.pem" "$root/backup-public.pem"
cp "$source/deployment/internal/pi-backup.sh" "$root/backup.sh"
chmod 700 "$root/backup.sh"
if [ ! -e "$root/internal.env" ]; then
  (umask 077; cat "$source/deployment/internal/internal.env.example" > "$root/internal.env";
    printf '\nBABYSTEPS_BOOTSTRAP_TOKEN_HASH=%s\n' "$(cat "$source/bootstrap-token.sha256")" >> "$root/internal.env")
fi
chmod 600 "$root/internal.env"
docker build -t "babysteps-internal:$release" -f "$source/deployment/internal/Dockerfile" "$source"
docker volume create babysteps-internal >/dev/null
previous=""
if docker container inspect babysteps-internal >/dev/null 2>&1; then
  "$root/backup.sh"
  previous="babysteps-internal-previous-$release"
  docker stop babysteps-internal >/dev/null
  docker rename babysteps-internal "$previous"
fi
restore_container() {
  docker rm -f babysteps-internal >/dev/null 2>&1 || true
  if [ -n "$previous" ]; then docker rename "$previous" babysteps-internal; docker start babysteps-internal >/dev/null; fi
}
if ! docker run -d --name babysteps-internal --restart unless-stopped \
  --network babysteps --env-file "$root/internal.env" -p 127.0.0.1:8790:8790 \
  --mount type=volume,source=babysteps-internal,target=/var/lib/babysteps \
  --read-only --memory 192m --memory-swap 256m --tmpfs /tmp:size=16m,noexec,nosuid \
  --security-opt no-new-privileges:true --cap-drop ALL \
  --log-opt max-file=3 --log-opt max-size=5m "babysteps-internal:$release" >/dev/null; then
  restore_container; exit 1
fi
healthy=0
for attempt in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:8790/api/v1/health >/dev/null; then healthy=1; break; fi
  sleep 1
done
if [ "$healthy" != 1 ]; then docker logs --tail 10 babysteps-internal; restore_container; exit 1; fi
cp -R "$source/dist-internal-web" "$www/releases/$release"
chmod -R a+rX "$www/releases/$release"
cp "$source/public/sw.js" "$www/legacy-sw.js"
cp "$source/deployment/internal/pi-proxy.conf" "$www/proxy.conf"
oldweb="$(readlink "$www/current" || true)"
ln -sfn "releases/$release" "$www/current.new"
mv -T "$www/current.new" "$www/current"
cp "$HOME/babysteps/nginx.conf" "$root/rollbacks/nginx-$release.conf"
if ! grep -qF 'include /srv/internal/proxy.conf;' "$HOME/babysteps/nginx.conf"; then
  python3 - <<'PY'
from pathlib import Path
p = Path.home() / 'babysteps/nginx.conf'
s = p.read_text()
assert s.count('server {') == 1
p.write_text(s.replace('server {', 'server {\n  include /srv/internal/proxy.conf;', 1))
PY
fi
if ! docker exec babysteps nginx -t; then
  cat "$root/rollbacks/nginx-$release.conf" > "$HOME/babysteps/nginx.conf"
  if [ -n "$oldweb" ]; then ln -sfn "$oldweb" "$www/current"; fi
  restore_container; exit 1
fi
docker exec babysteps nginx -s reload
"$root/backup.sh"
cron='17 3 * * * $HOME/babysteps/internal/backup.sh >> $HOME/babysteps/internal/backup.log 2>&1'
{ crontab -l 2>/dev/null | grep -v 'babysteps/internal/backup.sh' || true; printf '%s\n' "$cron"; } | crontab -
printf '%s\n' "$release" > "$root/current-release"
echo "Installed $release; public registration remains closed."
