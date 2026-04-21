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

usage() {
  cat <<EOF >&2
Usage: $0 [default|subscription|paid|personalized|url] [--json]

Fetch NanoGPT model discovery output.

Arguments:
  default       Fetch https://nano-gpt.com/api/v1/models?detailed=true
  subscription  Fetch https://nano-gpt.com/api/subscription/v1/models?detailed=true
  paid          Fetch https://nano-gpt.com/api/paid/v1/models?detailed=true
  personalized  Fetch https://nano-gpt.com/api/personalized/v1/models?detailed=true
  url           Any full https:// or http:// URL

Options:
  --json        Print raw JSON instead of pretty formatted output
  -h, --help    Show this help message
EOF
}

RAW_JSON=false
TARGET="default"

while [ $# -gt 0 ]; do
  case "$1" in
    --json)
      RAW_JSON=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    default|subscription|paid|personalized)
      TARGET="$1"
      shift
      ;;
    https://*|http://*)
      TARGET="$1"
      shift
      ;;
    *)
      echo "Invalid argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

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
    usage
    exit 1
    ;;
esac

HEADERS=("-H" "Accept: application/json")
if [ -n "${NANOGPT_API_KEY:-}" ]; then
  HEADERS+=("-H" "Authorization: Bearer ${NANOGPT_API_KEY}")
fi

printf "Fetching %s\n" "$URL"

RESPONSE="$(curl -sS "${HEADERS[@]}" "$URL")"

if [ "$RAW_JSON" = true ]; then
  printf '%s\n' "$RESPONSE"
  exit 0
fi

if command -v python3 >/dev/null 2>&1; then
  printf '%s\n' "$RESPONSE" | python3 -m json.tool
elif command -v python >/dev/null 2>&1; then
  printf '%s\n' "$RESPONSE" | python -m json.tool
elif command -v jq >/dev/null 2>&1; then
  printf '%s\n' "$RESPONSE" | jq .
else
  printf '%s\n' "$RESPONSE"
fi
