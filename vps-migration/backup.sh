#!/usr/bin/env bash
# Full backup of a Docker VPS (n8n, an ERP, any other compose project) so it can be
# restored on a new server with restore.sh.
#
#   bash backup.sh          live backup: each container is paused for a few seconds
#                           while its data is copied, then resumes
#   bash backup.sh --final  cutover backup: stops every container first and leaves
#                           them stopped (roll back with the docker start line it prints)
#
# Output: /var/backups/vps-migration/vps-backup-<date>.tar (+ .sha256)
# The archive holds the n8n encryption key and every .env file: keep it private and
# never commit it to a git repository.
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
command -v docker >/dev/null || { echo "docker not found." >&2; exit 1; }

MODE=live
[[ "${1:-}" == "--final" ]] && MODE=final

BASE=/var/backups/vps-migration
NAME=vps-backup-$(date +%Y%m%d-%H%M%S)
WORK=$BASE/$NAME
ARCHIVE=$BASE/$NAME.tar
mkdir -p "$WORK"/{meta,n8n,volumes,binds,compose,images,dumps}
chmod 700 "$BASE"

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
# GNU tar exits 1 when a file changed while it was read: harmless for a live copy.
tar_ok() { tar "$@" || [[ $? -eq 1 ]]; }

PAUSED=()
STOPPED=()
on_exit() {
  local rc=$?
  if [[ ${#PAUSED[@]} -gt 0 ]]; then docker unpause "${PAUSED[@]}" >/dev/null 2>&1 || true; fi
  if [[ $rc -ne 0 && ${#STOPPED[@]} -gt 0 ]]; then
    warn "backup failed: restarting the containers that were stopped"
    docker start "${STOPPED[@]}" >/dev/null 2>&1 || true
  fi
}
trap on_exit EXIT

# Running containers that mount host path $1 (a bind source or a volume mountpoint).
users_of() {
  local id
  for id in $(docker ps -q); do
    if docker inspect -f '{{range .Mounts}}{{.Source}}{{"\n"}}{{end}}' "$id" | grep -qxF "$1"; then
      echo "$id"
    fi
  done
}

# Copy host path $2 into archive $1; in live mode the containers using it are paused meanwhile.
copy_paused() {
  local out=$1 src=$2 users=()
  shift 2
  if [[ $MODE == live ]]; then
    mapfile -t users < <(users_of "$src")
    if [[ ${#users[@]} -gt 0 ]]; then
      PAUSED=("${users[@]}")
      docker pause "${users[@]}" >/dev/null
    fi
  fi
  tar_ok -czf "$out" "$@"
  if [[ ${#users[@]} -gt 0 ]]; then
    docker unpause "${users[@]}" >/dev/null
    PAUSED=()
  fi
}

mapfile -t ALL < <(docker ps -aq)
[[ ${#ALL[@]} -gt 0 ]] || { echo "No containers found." >&2; exit 1; }

log "Inventory ($MODE backup)"
{
  echo "# $(hostname) | $(date -Is) | mode=$MODE"
  docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
  echo
  docker volume ls
  echo
  df -h /
  free -m
} > "$WORK/meta/inventory.txt"
cat "$WORK/meta/inventory.txt"
docker inspect "${ALL[@]}" > "$WORK/meta/containers.json"
crontab -l > "$WORK/meta/crontab.txt" 2>/dev/null || true
if [[ -d /etc/cron.d ]]; then cp -a /etc/cron.d "$WORK/meta/cron.d"; fi
if [[ -f /etc/docker/daemon.json ]]; then cp /etc/docker/daemon.json "$WORK/meta/"; fi
if command -v ufw >/dev/null; then ufw status verbose > "$WORK/meta/ufw.txt" 2>&1 || true; fi

# Networks created by hand (no compose label) must exist before compose can start.
for net in $(docker network ls --format '{{.Name}}'); do
  case "$net" in bridge|host|none) continue ;; esac
  owner=$(docker network inspect -f '{{index .Labels "com.docker.compose.network"}}' "$net")
  driver=$(docker network inspect -f '{{.Driver}}' "$net")
  if [[ -z "$owner" || "$owner" == "<no value>" ]]; then echo "$net|$driver"; fi
done > "$WORK/meta/manual-networks.txt"

log "Images"
: > "$WORK/meta/images.txt"
for img in $(docker inspect -f '{{.Config.Image}}' "${ALL[@]}" | sort -u); do
  digest=$(docker image inspect -f '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' "$img" 2>/dev/null || true)
  if [[ -n "$digest" ]] && docker manifest inspect "$digest" >/dev/null 2>&1; then
    echo "$img $digest" >> "$WORK/meta/images.txt"
    echo "    $img (registry, pinned to its digest)"
  elif docker image inspect "$img" >/dev/null 2>&1; then
    # Built on this server (or gone from its registry): save it so the new server
    # doesn't have to rebuild it.
    echo "$img local" >> "$WORK/meta/images.txt"
    docker save "$img" | gzip > "$WORK/images/$(safe_name "$img").tar.gz"
    echo "    $img (built here, saved)"
  fi
done

log "n8n"
for c in $(docker ps --format '{{.Names}} {{.Image}}' | awk '$2 ~ /n8nio\/n8n/ {print $1}'); do
  d="$WORK/n8n/$c"
  mkdir -p "$d"
  docker exec "$c" n8n --version > "$d/version.txt" 2>/dev/null || true
  key=$(n8n_key "$c")
  if [[ -n "$key" ]]; then
    printf '%s\n' "$key" > "$d/encryption-key.txt"
    echo "    $c: n8n $(cat "$d/version.txt"), encryption key saved"
  else
    warn "$c: encryption key NOT found; without it the credentials cannot be decrypted elsewhere"
  fi
  if docker exec "$c" sh -c 'rm -rf /tmp/n8n-export \
      && mkdir -p /tmp/n8n-export/workflows /tmp/n8n-export/credentials \
      && n8n export:workflow --all --separate --output=/tmp/n8n-export/workflows/ \
      && n8n export:credentials --all --separate --output=/tmp/n8n-export/credentials/' \
      > "$d/export.log" 2>&1; then
    docker cp "$c:/tmp/n8n-export/." "$d/" >/dev/null
    docker exec "$c" rm -rf /tmp/n8n-export
    echo "    $c: $(find "$d/workflows" -type f | wc -l) workflows, $(find "$d/credentials" -type f | wc -l) credentials exported (credentials stay encrypted)"
  else
    warn "$c: CLI export failed (see n8n/$c/export.log); the volume copy below still holds everything"
  fi
done

log "Database dumps"
while read -r c img; do
  case "$img" in
    *postgres*|*postgis*)
      if docker exec "$c" sh -c 'pg_dumpall -U "${POSTGRES_USER:-postgres}"' | gzip > "$WORK/dumps/$c.sql.gz"; then
        echo "    $c: pg_dumpall ok"
      else
        warn "$c: pg_dumpall failed; the volume copy below still holds the data"
      fi
      ;;
  esac
done < <(docker ps --format '{{.Names}} {{.Image}}')

if [[ $MODE == final ]]; then
  log "Stopping every container (cutover)"
  mapfile -t STOPPED < <(docker ps --format '{{.Names}}')
  if [[ ${#STOPPED[@]} -gt 0 ]]; then docker stop "${STOPPED[@]}" >/dev/null; fi
  echo "    stopped: ${STOPPED[*]:-none}"
fi

log "Volumes"
docker inspect -f '{{$c := .Name}}{{range .Mounts}}{{if eq .Type "volume"}}{{$c}}|{{.Name}}|{{.Destination}}{{"\n"}}{{end}}{{end}}' "${ALL[@]}" \
  | sed -e 's#^/##' -e '/^$/d' > "$WORK/meta/volume-mounts.txt"
for v in $(cut -d'|' -f2 "$WORK/meta/volume-mounts.txt" | sort -u); do
  mp=$(docker volume inspect -f '{{.Mountpoint}}' "$v")
  docker volume inspect -f '{{range $k, $val := .Labels}}{{$k}}={{$val}}{{"\n"}}{{end}}' "$v" \
    | sed '/^$/d' > "$WORK/volumes/$v.labels"
  copy_paused "$WORK/volumes/$v.tar.gz" "$mp" -C "$mp" .
  echo "    $v  $(du -h "$WORK/volumes/$v.tar.gz" | cut -f1)"
done

log "Bind mounts"
for b in $(docker inspect -f '{{range .Mounts}}{{if eq .Type "bind"}}{{.Source}}{{"\n"}}{{end}}{{end}}' "${ALL[@]}" | sed '/^$/d' | sort -u); do
  case "$b" in
    /var/run/docker.sock|/run/*|/proc*|/sys*|/dev*|/etc/localtime|/etc/timezone|/etc/hostname|/etc/hosts|/etc/resolv.conf|/var/lib/docker*) continue ;;
  esac
  [[ -e "$b" ]] || continue
  copy_paused "$WORK/binds/$(safe_name "${b#/}").tar.gz" "$b" -C / "${b#/}"
  echo "    $b"
done

log "Compose projects"
docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.project.working_dir"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}' "${ALL[@]}" \
  | grep -v -e '^|' -e '<no value>' | sort -u > "$WORK/meta/compose-projects.txt" || true
while IFS='|' read -r proj dir _; do
  if [[ ! -d "$dir" ]]; then warn "$proj: $dir no longer exists"; continue; fi
  tar_ok -czf "$WORK/compose/$proj.tar.gz" --warning=no-file-changed \
    --exclude=node_modules --exclude=.cache --exclude=.ssh --exclude=.bash_history --exclude=snap \
    --exclude="${BASE#/}" -C / "${dir#/}"
  echo "    $proj  ($dir)"
done < "$WORK/meta/compose-projects.txt"

log "Packing"
tar -cf "$ARCHIVE" -C "$BASE" "$NAME"
rm -rf "$WORK"
chmod 600 "$ARCHIVE"
(cd "$BASE" && sha256sum "$NAME.tar" > "$NAME.tar.sha256")

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
cat <<EOF

Backup ready: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))

Copy it to your computer (run there):
  scp root@${IP:-<this-server-ip>}:$ARCHIVE* .
Or pull it straight onto the new VPS (run there):
  scp root@${IP:-<this-server-ip>}:$ARCHIVE* /root/
EOF
if [[ ${#STOPPED[@]} -gt 0 ]]; then
  echo
  echo "Every container is STOPPED. To roll back to this server: docker start ${STOPPED[*]}"
fi
