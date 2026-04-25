#!/bin/zsh
cd "$(dirname "$0")"

if command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine "$PWD" 2>/dev/null || true
fi

resolve_bundled_node() {
  local detected_arch="$(uname -m 2>/dev/null || echo '')"
  local -a candidates

  case "$detected_arch" in
    arm64|aarch64)
      candidates=(
        "$PWD/runtime/arm64/bin/node"
        "$PWD/runtime/bin/node"
        "$PWD/runtime/x64/bin/node"
      )
      ;;
    x86_64|amd64)
      candidates=(
        "$PWD/runtime/x64/bin/node"
        "$PWD/runtime/bin/node"
        "$PWD/runtime/arm64/bin/node"
      )
      ;;
    *)
      candidates=(
        "$PWD/runtime/bin/node"
        "$PWD/runtime/arm64/bin/node"
        "$PWD/runtime/x64/bin/node"
      )
      ;;
  esac

  for candidate in "${candidates[@]}"; do
    if [ -f "$candidate" ]; then
      chmod +x "$candidate" 2>/dev/null || true
    fi
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

BUNDLED_NODE="$(resolve_bundled_node)"

if [ -n "$BUNDLED_NODE" ] && [ -x "$BUNDLED_NODE" ]; then
  "$BUNDLED_NODE" "./scripts/start-goodypos.mjs" "$@"
  exit $?
fi

if command -v node >/dev/null 2>&1; then
  node "./scripts/start-goodypos.mjs" "$@"
  exit $?
fi

echo "GoodyPOS could not find its bundled runtime. Please re-extract the full release package and try again."
exit 1
