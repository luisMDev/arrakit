#!/usr/bin/env bash
# Runs RustFS, the local S3-compatible storage the API uses in dev and e2e (R2_* pointing at it).
# Uses `rustfs` from PATH when installed, otherwise downloads the pinned release once into
# .data/bin. Arguments are passed through, e.g.
# `--address 127.0.0.1:5030 --console-address 127.0.0.1:5031 .data/rustfs`.
# The credentials default to the ones in apps/api/.env.example.
set -euo pipefail

VERSION=1.0.4
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bin="$root/.data/bin/rustfs-$VERSION"

export RUSTFS_ACCESS_KEY="${RUSTFS_ACCESS_KEY:-arrakit}"
export RUSTFS_SECRET_KEY="${RUSTFS_SECRET_KEY:-arrakit-local-secret}"
mkdir -p "${!#}"

if command -v rustfs >/dev/null 2>&1; then
  exec rustfs server "$@"
fi

if [ ! -x "$bin" ]; then
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64 | Linux-amd64) asset=rustfs-linux-x86_64-musl ;;
    Linux-aarch64 | Linux-arm64) asset=rustfs-linux-aarch64-musl ;;
    Darwin-arm64) asset=rustfs-macos-aarch64 ;;
    *)
      echo "[rustfs] no release for $(uname -s) $(uname -m); install rustfs and put it on PATH" >&2
      exit 1
      ;;
  esac
  url="https://github.com/rustfs/rustfs/releases/download/$VERSION/$asset-v$VERSION.zip"
  echo "[rustfs] downloading $url" >&2
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL -o "$tmp/rustfs.zip" "$url"
  unzip -q -j "$tmp/rustfs.zip" rustfs -d "$tmp"
  mkdir -p "$(dirname "$bin")"
  mv "$tmp/rustfs" "$bin"
  chmod +x "$bin"
fi

exec "$bin" server "$@"
