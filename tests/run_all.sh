#!/usr/bin/env bash
set -Eeuo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/.." && pwd)"
RUN_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/bid-dog-tests.XXXXXX")"
ARTIFACT_DIR="$TEST_DIR/.artifacts"
ENGINE_PID=""

cleanup() {
  if [[ -n "$ENGINE_PID" ]] && kill -0 "$ENGINE_PID" 2>/dev/null; then
    kill "$ENGINE_PID" 2>/dev/null || true
    wait "$ENGINE_PID" 2>/dev/null || true
  fi
  rm -rf "$RUN_ROOT"
}
trap cleanup EXIT INT TERM

mkdir -p "$ARTIFACT_DIR" "$RUN_ROOT/data"
export BID_HOME="$RUN_ROOT/data"
export BID_WEB_DIR="$REPO_ROOT/app/src"
export BID_NO_UPDATE_CHECK=1
export BID_MODELS_TTL=0
export PYTHONPATH="$REPO_ROOT/server${PYTHONPATH:+:$PYTHONPATH}"

python3 -m pytest -c "$TEST_DIR/pytest.ini" -m "not acceptance" "$TEST_DIR"

# Lightweight Node source/logic checks do not need a browser.
while IFS= read -r check_file; do
  node "$check_file"
done < <(find "$TEST_DIR" -maxdepth 1 -name 'check_*.js' ! -name '*.spec.js' -print | sort)

# Playwright checks are also offline: they talk only to the engine below.  Keep
# them conditional so the backend suite remains runnable while browser tests
# are being reconstructed from the lost scratchpad.
if find "$TEST_DIR" -maxdepth 1 -name 'check_*.spec.js' -print -quit | grep -q .; then
  if [[ ! -x "$TEST_DIR/node_modules/.bin/playwright" ]]; then
    echo "Browser tests exist but Playwright is not installed. Run: npm ci --prefix tests" >&2
    exit 2
  fi
  TEST_PORT="$(python3 - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    print(sock.getsockname()[1])
PY
)"
  export PORT="$TEST_PORT"
  export BIDDOG_TEST_URL="http://127.0.0.1:$TEST_PORT"
  python3 "$REPO_ROOT/server/engine_v1.py" >"$ARTIFACT_DIR/engine.log" 2>&1 &
  ENGINE_PID=$!
  python3 - <<'PY'
import os, time, urllib.request
url = os.environ['BIDDOG_TEST_URL'] + '/v1/health'
for _ in range(100):
    try:
        with urllib.request.urlopen(url, timeout=.2) as response:
            if response.status == 200:
                break
    except Exception:
        time.sleep(.1)
else:
    raise SystemExit('test engine did not become healthy')
PY
  (cd "$TEST_DIR" && npm test)
fi
