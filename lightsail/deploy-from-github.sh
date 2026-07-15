#!/usr/bin/env bash
# This script is invoked by a forced SSH command. It accepts exactly one
# release archive on stdin from the GitHub-hosted deployment workflow.
#
# The archive may contain only an already-tested application image and its
# manifest. Compose and this script are production platform configuration and
# must be changed through a separate, human-operated platform release.
set -Eeuo pipefail

readonly DEPLOY_PATH="/home/ubuntu/agentic-football-event-ops"
readonly COMPOSE_FILE="$DEPLOY_PATH/lightsail/docker-compose.feedback-ip.yml"
readonly PROJECT_NAME="agentic-football-feedback"
readonly APP_CONTAINER="agentic-football-feedback"

umask 077
release_dir="$(mktemp -d)"
previous_image=""

cleanup() {
  rm -rf "$release_dir"
}

rollback() {
  local exit_code=$?
  echo "Candidate deployment failed; restoring the previous application image." >&2
  sudo docker logs --tail 150 "$APP_CONTAINER" >&2 || true

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
  "$release_dir/lightsail-image.tar"; do
  [ -f "$required_file" ] || { echo "Invalid deployment archive: missing ${required_file#$release_dir/}" >&2; exit 2; }
done

candidate_image="$(sed -n 's/^CANDIDATE_IMAGE=//p' "$release_dir/manifest.env")"
if [[ ! "$candidate_image" =~ ^agentic-football-event-ops:feedback-[0-9a-f]{40}$ ]]; then
  echo "Invalid candidate image in deployment manifest." >&2
  exit 2
fi

previous_image="$(sudo docker inspect --format '{{.Config.Image}}' "$APP_CONTAINER" 2>/dev/null || true)"

sudo docker load --input "$release_dir/lightsail-image.tar"
sudo docker image inspect "$candidate_image" >/dev/null

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
