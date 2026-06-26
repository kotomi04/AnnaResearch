#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

EXECUTA_JSON="executa.json"
ENTRY_FILE="researcher_plugin.py"
OUT_DIR="dist-anna"

if [ ! -f "$EXECUTA_JSON" ]; then
  echo "ERROR: $EXECUTA_JSON not found" >&2
  exit 1
fi

if [ ! -f "$ENTRY_FILE" ]; then
  echo "ERROR: $ENTRY_FILE not found" >&2
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "ERROR: uv is required. Please install uv first." >&2
  exit 1
fi

TOOL_ID="$(python3 - <<'PY'
import json
with open("executa.json", "r", encoding="utf-8") as f:
    data = json.load(f)
print(data["tool_id"])
PY
)"

VERSION="$(python3 - <<'PY'
import json
with open("executa.json", "r", encoding="utf-8") as f:
    data = json.load(f)
print(data.get("version") or "0.0.0")
PY
)"

DISPLAY_NAME="$(python3 - <<'PY'
import json
with open("executa.json", "r", encoding="utf-8") as f:
    data = json.load(f)
print(data.get("name") or data["tool_id"])
PY
)"

DESCRIPTION="$(python3 - <<'PY'
import json
with open("executa.json", "r", encoding="utf-8") as f:
    data = json.load(f)
print(data.get("description") or "")
PY
)"

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$ARCH" in
  x86_64|amd64)
    ARCH="x86_64"
    ;;
  arm64|aarch64)
    ARCH="arm64"
    ;;
esac

case "$OS-$ARCH" in
  darwin-arm64)
    PLATFORM="darwin-arm64"
    ;;
  darwin-x86_64)
    PLATFORM="darwin-x86_64"
    ;;
  linux-x86_64)
    PLATFORM="linux-x86_64"
    ;;
  *)
    echo "ERROR: unsupported platform: $OS-$ARCH" >&2
    echo "This tutorial script currently targets: darwin-arm64, darwin-x86_64, linux-x86_64" >&2
    exit 1
    ;;
esac

echo "Tool ID:  $TOOL_ID"
echo "Version:  $VERSION"
echo "Platform: $PLATFORM"
echo

rm -rf build dist "$OUT_DIR/staging-$PLATFORM"
mkdir -p "$OUT_DIR/staging-$PLATFORM/bin"

echo "==> Building single-file executable with PyInstaller"

uv run --with pyinstaller python -m PyInstaller \
  --onefile \
  --clean \
  --noupx \
  --name "$TOOL_ID" \
  "$ENTRY_FILE"

BINARY="dist/$TOOL_ID"

if [ ! -f "$BINARY" ]; then
  echo "ERROR: PyInstaller did not produce $BINARY" >&2
  exit 1
fi

if [ "$(uname -s)" = "Darwin" ]; then
  codesign --force --sign - "$BINARY" 2>/dev/null || true
fi

STAGE="$OUT_DIR/staging-$PLATFORM"
cp "$BINARY" "$STAGE/bin/$TOOL_ID"
chmod 0755 "$STAGE/bin/$TOOL_ID"

echo "==> Writing archive manifest"

python3 - "$STAGE/manifest.json" "$TOOL_ID" "$VERSION" "$DISPLAY_NAME" "$DESCRIPTION" <<'PY'
import json
import sys
from pathlib import Path

manifest_path = Path(sys.argv[1])
tool_id = sys.argv[2]
version = sys.argv[3]
display_name = sys.argv[4]
description = sys.argv[5]

entrypoint = f"bin/{tool_id}"

manifest = {
    "name": tool_id,
    "display_name": display_name,
    "version": version,
    "description": description,
    "runtime": {
        "binary": {
            "entrypoint": {
                "default": entrypoint
            },
            "permissions": {
                entrypoint: "0o755"
            }
        }
    }
}

manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
PY

ARCHIVE="$OUT_DIR/$TOOL_ID-$PLATFORM.tar.gz"

echo "==> Creating archive: $ARCHIVE"

(
  cd "$STAGE"
  tar czf "../$TOOL_ID-$PLATFORM.tar.gz" .
)

if command -v shasum >/dev/null 2>&1; then
  SHA256="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
else
  SHA256="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
fi

SIZE="$(wc -c < "$ARCHIVE" | tr -d ' ')"

echo
echo "Built archive:"
echo "  $ARCHIVE"
echo
echo "SHA-256:"
echo "  $SHA256"
echo
echo "Size:"
echo "  $SIZE bytes"
echo
echo "Archive layout:"
tar tzf "$ARCHIVE"
echo
echo "Later, the platform binary asset for this platform will look like:"
echo
cat <<JSON
"$PLATFORM": {
  "url": "https://github.com/kotomi04/AnnaResearch/releases/download/researcher-python-v$VERSION/$TOOL_ID-$PLATFORM.tar.gz",
  "sha256": "$SHA256",
  "size": $SIZE,
  "entrypoint": "bin/$TOOL_ID",
  "format": "tar.gz"
}
JSON