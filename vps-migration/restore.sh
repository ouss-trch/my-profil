#!/usr/bin/env bash
# Restore a backup made by backup.sh onto a fresh VPS (plain Ubuntu, or Ubuntu + Docker).
#
#   bash restore.sh /root/vps-backup-YYYYMMDD-HHMMSS.tar
#
# Put things back exactly where they were: same image versions, volumes (with their
# labels), bind-mounted folders, compose folders and .env files, then starts every
# compose project. Refuses to overwrite a volume that already exists on this server.
set -euo pipefail
shopt -s nullglob

[[ $EUID -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
ARCHIVE=${1:?usage: bash restore.sh <vps-backup-....tar>}
[[ -f "$ARCHIVE" ]] || { echo "$ARCHIVE not found." >&2; exit 1; }

log() { printf '\n==> %s\n' "$*"; }
warn() { printf '    !! %s\n' "$*" >&2; }
safe_name() { printf '%s' "$1" | tr '/:@' '___'; }
# Encryption key of n8n container $1: the env var wins, else the key n8n generated in its config file.
n8n_key() {
  local k
  k=$(docker exec "$1" sh -c 'printf %s "${N8N_ENCRYPTION_KEY:-}"' 2>/dev/null || true)
  if [[ -z "$k" ]]; then
    k=$(docker exec "$1" sh -c 'cat "${N8N_USER_FOLDER:-/home/node}/.n8n/config"' 2>/dev/null \
      | sed -n 's/.*"encryptionKey"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' || true)
  fi
  printf '%s' "$k"
}

if [[ -f "$ARCHIVE.sha256" ]]; then
  log "Checking archive integrity"
  (cd "$(dirname "$ARCHIVE")" && sha256sum -c "$(basename "$ARCHIVE").sha256")
fi

if ! command -v docker >/dev/null; then
  log "Installing Docker"
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null || { echo "The docker compose plugin is missing." >&2; exit 1; }

DIR=/var/backups/vps-restore
rm -rf "$DIR"
mkdir -p "$DIR"
chmod 700 "$DIR"
tar -xf "$ARCHIVE" -C "$DIR"
SRC=$(find "$DIR" -mindepth 1 -maxdepth 1 -type d | head -1)
echo "Backup taken on: $(head -1 "$SRC/meta/inventory.txt")"

log "Checking this server is clean"
clash=0
for f in "$SRC"/volumes/*.tar.gz; do
  v=$(basename "$f" .tar.gz)
  if docker volume inspect "$v" >/dev/null 2>&1; then warn "volume $v already exists"; clash=1; fi
done
if [[ $clash -eq 1 && "${FORCE:-0}" != 1 ]]; then
  cat >&2 <<'EOF'
This server already has volumes with the same names (the n8n OS template creates its
own n8n with a different encryption key). Reinstall the VPS with plain "Ubuntu 24.04"
or "Ubuntu 24.04 with Docker", or remove those volumes, then run this again.
EOF
  exit 1
fi
echo "    ok"

log "Images (same versions as the old server)"
while read -r img ref; do
  if [[ "$ref" == local ]]; then
    f="$SRC/images/$(safe_name "$img").tar.gz"
    if [[ -f "$f" ]]; then gunzip -c "$f" | docker load >/dev/null && echo "    $img (loaded from backup)"; fi
  elif docker pull -q "$ref" >/dev/null 2>&1; then
    if [[ "$img" != sha256:* && "$img" != *@* ]]; then docker tag "$ref" "$img"; fi
    echo "    $img"
  else
    warn "could not pull $ref; compose will pull $img instead"
  fi
done < "$SRC/meta/images.txt"

log "Networks"
while IFS='|' read -r net driver; do
  [[ -n "$net" ]] || continue
  if ! docker network inspect "$net" >/dev/null 2>&1; then docker network create --driver "$driver" "$net" >/dev/null; fi
  echo "    $net"
done < "$SRC/meta/manual-networks.txt"

log "Volumes"
for f in "$SRC"/volumes/*.tar.gz; do
  v=$(basename "$f" .tar.gz)
  [[ "$v" =~ ^[0-9a-f]{64}$ ]] && continue  # anonymous: filled in once its container exists
  labels=()
  while IFS= read -r l; do [[ -n "$l" ]] && labels+=(--label "$l"); done < "$SRC/volumes/$v.labels"
  docker volume inspect "$v" >/dev/null 2>&1 || docker volume create "${labels[@]}" "$v" >/dev/null
  tar -xzf "$f" -C "$(docker volume inspect -f '{{.Mountpoint}}' "$v")"
  echo "    $v"
done

log "Compose folders and bind mounts"
for f in "$SRC"/compose/*.tar.gz; do tar -xzf "$f" -C /; echo "    $(basename "$f" .tar.gz)"; done
# After the compose folders, so data copied while paused wins over the live copy.
for f in "$SRC"/binds/*.tar.gz; do tar -xzf "$f" -C /; done

log "Starting compose projects"
# Two rounds: a project may use a network that another project creates.
pending=$(cat "$SRC/meta/compose-projects.txt")
for round in 1 2; do
  failed=""
  while IFS='|' read -r proj dir files; do
    [[ -n "$proj" ]] || continue
    args=()
    IFS=',' read -ra list <<< "$files"
    for x in "${list[@]}"; do args+=(-f "$x"); done
    if (cd "$dir" && docker compose -p "$proj" "${args[@]}" up -d) > "$DIR/compose-$proj.log" 2>&1; then
      echo "    $proj: up"
    else
      failed+="$proj|$dir|$files"$'\n'
      [[ $round -eq 2 ]] && warn "$proj failed to start, see $DIR/compose-$proj.log"
    fi
  done <<< "$pending"
  pending=$failed
  [[ -z "$pending" ]] && break
done

log "Anonymous volumes"
while IFS='|' read -r cname vol dest; do
  [[ "$vol" =~ ^[0-9a-f]{64}$ ]] || continue
  f="$SRC/volumes/$vol.tar.gz"
  [[ -f "$f" ]] || continue
  new=$(docker inspect -f "{{range .Mounts}}{{if eq .Destination \"$dest\"}}{{.Name}}{{end}}{{end}}" "$cname" 2>/dev/null || true)
  if [[ -z "$new" ]]; then warn "$cname has no volume at $dest; data left in $f"; continue; fi
  docker stop "$cname" >/dev/null
  tar -xzf "$f" -C "$(docker volume inspect -f '{{.Mountpoint}}' "$new")"
  docker start "$cname" >/dev/null
  echo "    $cname:$dest"
done < "$SRC/meta/volume-mounts.txt"

log "n8n encryption key"
for d in "$SRC"/n8n/*/; do
  c=$(basename "$d")
  [[ -f "$d/encryption-key.txt" ]] || continue
  key=""
  for _ in $(seq 1 30); do key=$(n8n_key "$c"); [[ -n "$key" ]] && break; sleep 2; done
  if [[ "$key" == "$(cat "$d/encryption-key.txt")" ]]; then
    echo "    $c: same key as the old server, credentials will decrypt"
  else
    warn "$c: key differs from the old server! Set N8N_ENCRYPTION_KEY=$(cat "$d/encryption-key.txt") for it and restart"
  fi
done

log "Done"
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
cat <<EOF

Next:
  1. Point the DNS A records of your domains to this server: $(hostname -I 2>/dev/null | awk '{print $1}')
  2. Open n8n and the other apps, run one test of each important workflow.
  3. Old cron jobs (not reinstalled automatically): $SRC/meta/crontab.txt
  4. When everything works, delete $DIR (it holds secrets).
EOF
