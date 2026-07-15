#!/usr/bin/env bash
# This script is invoked by a forced SSH command. It accepts exactly one
# release archive on stdin from the GitHub-hosted deployment workflow.
set -Eeuo pipefail

readonly DEPLOY_PATH="/home/ubuntu/agentic-football-event-ops"
readonly COMPOSE_FILE="$DEPLOY_PATH/lightsail/docker-compose.feedback-ip.yml"
readonly PROJECT_NAME="agentic-football-feedback"
readonly APP_CONTAINER="agentic-football-feedback"

umask 077
release_dir="$(mktemp -d)"
previous_image=""
config_backup=""

cleanup() {
  rm -rf "$release_dir"
  if [ -n "$config_backup" ]; then
    rm -rf "$config_backup"
  fi
}

rollback() {
  local exit_code=$?
  echo "Candidate deployment failed; restoring the previous application image." >&2
  sudo docker logs --tail 150 "$APP_CONTAINER" >&2 || true

  if [ -n "$config_backup" ]; then
    cp "$config_backup/docker-compose.feedback-ip.yml" "$COMPOSE_FILE" || true
    cp "$config_backup/deploy-from-github.sh" "$DEPLOY_PATH/lightsail/deploy-from-github.sh" || true
    chmod 700 "$DEPLOY_PATH/lightsail/deploy-from-github.sh" || true
  fi

  if [ -n "$previous_image" ]; then
    sudo env APP_IMAGE="$previous_image" docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" \
      up -d --no-deps --force-recreate app || true
  fi
  exit "$exit_code"
}

trap rollback ERR
trap cleanup EXIT

tar -xzf - -C "$release_dir"

for required_file in \
  "$release_dir/manifest.env" \
  "$release_dir/lightsail-image.tar" \
  "$release_dir/lightsail/docker-compose.feedback-ip.yml" \
  "$release_dir/lightsail/deploy-from-github.sh"; do
  [ -f "$required_file" ] || { echo "Invalid deployment archive: missing ${required_file#$release_dir/}" >&2; exit 2; }
done

candidate_image="$(sed -n 's/^CANDIDATE_IMAGE=//p' "$release_dir/manifest.env")"
if [[ ! "$candidate_image" =~ ^agentic-football-event-ops:feedback-[0-9a-f]{40}$ ]]; then
  echo "Invalid candidate image in deployment manifest." >&2
  exit 2
fi

previous_image="$(sudo docker inspect --format '{{.Config.Image}}' "$APP_CONTAINER" 2>/dev/null || true)"
config_backup="$(mktemp -d)"
cp "$COMPOSE_FILE" "$config_backup/docker-compose.feedback-ip.yml"
cp "$DEPLOY_PATH/lightsail/deploy-from-github.sh" "$config_backup/deploy-from-github.sh"

sudo docker load --input "$release_dir/lightsail-image.tar"
sudo docker image inspect "$candidate_image" >/dev/null

cp "$release_dir/lightsail/docker-compose.feedback-ip.yml" "$COMPOSE_FILE"
cp "$release_dir/lightsail/deploy-from-github.sh" "$DEPLOY_PATH/lightsail/deploy-from-github.sh"
chmod 700 "$DEPLOY_PATH/lightsail/deploy-from-github.sh"

sudo env APP_IMAGE="$candidate_image" docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" \
  up -d --no-deps --force-recreate app

for attempt in $(seq 1 12); do
  health="$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$APP_CONTAINER")"
  if [ "$health" = "healthy" ]; then
    break
  fi
  echo "Waiting for app health ($attempt/12): $health"
  sleep 5
done

[ "$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$APP_CONTAINER")" = "healthy" ]
curl --fail --silent --show-error --connect-timeout 5 --max-time 10 --insecure https://127.0.0.1/healthz
sudo docker tag "$candidate_image" agentic-football-event-ops:feedback
echo "Deployment completed: $candidate_image"
