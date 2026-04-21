#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a
  . "$ENV_FILE"
  set +a
fi

if [ ${#@} -gt 1 ]; then
  echo "Usage: $0 [default|subscription|paid|personalized|url]" >&2
  exit 1
fi

TARGET="${1:-default}"
case "$TARGET" in
  default)
    URL="https://nano-gpt.com/api/v1/models?detailed=true"
    ;;
  subscription)
    URL="https://nano-gpt.com/api/subscription/v1/models?detailed=true"
    ;;
  paid)
    URL="https://nano-gpt.com/api/paid/v1/models?detailed=true"
    ;;
  personalized)
    URL="https://nano-gpt.com/api/personalized/v1/models?detailed=true"
    ;;
  https://*|http://*)
    URL="$TARGET"
    ;;
  *)
    echo "Invalid target: $TARGET" >&2
    echo "Usage: $0 [default|subscription|paid|personalized|url]" >&2
    exit 1
    ;;
esac

HEADERS=("-H" "Accept: application/json")
if [ -n "${NANOGPT_API_KEY:-}" ]; then
  HEADERS+=("-H" "Authorization: Bearer ${NANOGPT_API_KEY}")
fi

printf "Fetching %s\n" "$URL"
curl -sS "${HEADERS[@]}" "$URL"
printf "\n"
