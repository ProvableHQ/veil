#!/usr/bin/env bash
# Install aleo-devnode from the latest GitHub release.
#
# Usage:
#   ./install.sh                      # installs to /usr/local/bin (may need sudo)
#   INSTALL_DIR=~/.local/bin ./install.sh
#   VERSION=v0.1.1 ./install.sh       # pin a specific release

set -euo pipefail

REPO="ProvableHQ/aleo-devnode"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"
BINARY_NAME="aleo-devnode"

# ── Resolve version ────────────────────────────────────────────────────────────

if [[ -n "${VERSION:-}" ]]; then
  TAG="$VERSION"
else
  echo "Fetching latest release..."
  TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
fi

if [[ -z "$TAG" ]]; then
  echo "error: could not determine release version" >&2
  exit 1
fi

echo "Installing aleo-devnode ${TAG}..."

# ── Detect platform ────────────────────────────────────────────────────────────

OS=$(uname -s)
ARCH=$(uname -m)

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64)  PLATFORM="aarch64-apple-darwin" ;;
      x86_64) PLATFORM="x86_64-apple-darwin" ;;
      *) echo "error: unsupported macOS architecture: $ARCH" >&2; exit 1 ;;
    esac
    ;;
  Linux)
    case "$ARCH" in
      x86_64) PLATFORM="x86_64-unknown-linux-gnu" ;;
      *) echo "error: unsupported Linux architecture: $ARCH" >&2; exit 1 ;;
    esac
    ;;
  *)
    echo "error: unsupported OS: $OS (use the Windows zip from https://github.com/${REPO}/releases)" >&2
    exit 1
    ;;
esac

# ── Download and extract ───────────────────────────────────────────────────────

ARCHIVE="aleo-devnode-${TAG}-${PLATFORM}.zip"
URL="https://github.com/${REPO}/releases/download/${TAG}/${ARCHIVE}"
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo "Downloading ${URL}..."
curl -fsSL --output "${TMPDIR}/${ARCHIVE}" "$URL"

unzip -q "${TMPDIR}/${ARCHIVE}" -d "$TMPDIR"

BINARY=$(find "$TMPDIR" -type f -name "$BINARY_NAME" | head -1)
if [[ -z "$BINARY" ]]; then
  echo "error: could not find '${BINARY_NAME}' binary in the archive" >&2
  exit 1
fi

# ── Install ────────────────────────────────────────────────────────────────────

mkdir -p "$INSTALL_DIR"
install -m 755 "$BINARY" "${INSTALL_DIR}/${BINARY_NAME}"

echo "Installed ${INSTALL_DIR}/${BINARY_NAME} (${TAG})"

# Warn if the install dir is not on PATH
if ! echo ":${PATH}:" | grep -q ":${INSTALL_DIR}:"; then
  echo ""
  echo "Note: ${INSTALL_DIR} is not in your PATH."
  echo "Add the following to your shell profile:"
  echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
fi
