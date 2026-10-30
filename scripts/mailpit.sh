#!/usr/bin/env bash
# Runs Mailpit, the local inbox the API sends to when RESEND_API_KEY is unset (MAILPIT_URL).
# Uses `mailpit` from PATH when installed, otherwise downloads the pinned release once into
# .data/bin. Arguments are passed through, e.g. `--listen localhost:5025 --smtp localhost:5026`.
set -euo pipefail

VERSION=v1.32.0
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bin="$root/.data/bin/mailpit-$VERSION"

if command -v mailpit >/dev/null 2>&1; then
  exec mailpit "$@"
fi

if [ ! -x "$bin" ]; then
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) echo "[mailpit] unsupported OS $(uname -s); install mailpit and put it on PATH" >&2; exit 1 ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch=amd64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *) echo "[mailpit] unsupported CPU $(uname -m); install mailpit and put it on PATH" >&2; exit 1 ;;
  esac
  url="https://github.com/axllent/mailpit/releases/download/$VERSION/mailpit-$os-$arch.tar.gz"
  echo "[mailpit] downloading $url" >&2
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL "$url" | tar -xz -C "$tmp" mailpit
  mkdir -p "$(dirname "$bin")"
  mv "$tmp/mailpit" "$bin"
  chmod +x "$bin"
fi

exec "$bin" "$@"
