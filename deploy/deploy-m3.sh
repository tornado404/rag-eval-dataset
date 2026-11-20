#!/bin/bash
set -euo pipefail
trap 'status=$?; echo "DEPLOY_ERROR line=${BASH_LINENO[0]} status=$status command=$BASH_COMMAND" >&2; exit "$status"' ERR

if [[ -z "${GITHUB_WORKSPACE:-}" ]]; then
  echo "GITHUB_WORKSPACE is required; run this script from the deploy workflow" >&2
  exit 1
fi

SOURCE_DIR="$GITHUB_WORKSPACE"
SOURCE_SHA="${GITHUB_SHA:-$(git -C "$SOURCE_DIR" rev-parse HEAD)}"
DEPLOY_SHA="${INPUT_SHA:-$SOURCE_SHA}"
APP_DIR="$HOME/apps/rag-eval-dataset"
DATA_DIR="$HOME/apps/rag-eval-data"
NODE_BIN="/path/to/project"
PLIST="$HOME/Library/LaunchAgents/com.tornado404.rag-eval-dataset.plist"
LABEL="com.tornado404.rag-eval-dataset"
PORT="4183"
GOLDEN_PORT="4183"
CONFIG_DIR="$HOME/.config/rag-eval-dataset"
EVAL_CONFIG="$CONFIG_DIR/eval.env"
GOLDEN_CONFIG="$CONFIG_DIR/golden.env"
LAN_INTERFACE="$({ route -n get default 2>/dev/null || true; } | awk '$1 == "interface:" {print $2; exit}')"
LAN_IP=""
if [[ -n "$LAN_INTERFACE" ]]; then
  LAN_IP="$(ipconfig getifaddr "$LAN_INTERFACE" 2>/dev/null || true)"
fi
if [[ -z "$LAN_IP" ]]; then
  LAN_IP="$(ifconfig | awk '/inet / && $2 !~ /^127\./ && $2 !~ /^169\.254\./ {print $2; exit}')"
fi

mkdir -p "$HOME/apps" "$HOME/Library/LaunchAgents"
mkdir -p "$DATA_DIR/golden-v1"
if [[ -d "$APP_DIR/datasets/golden-v1" ]]; then
  cp -Rn "$APP_DIR/datasets/golden-v1/." "$DATA_DIR/golden-v1/"
fi
if [[ -f "$EVAL_CONFIG" && ! -f "$GOLDEN_CONFIG" ]]; then
  DATASET_IDS="$(sed -n 's/^RAGFLOW_DATASET_IDS=//p' "$EVAL_CONFIG" | head -n 1)"
  {
    grep -E '^(RAGFLOW_BASE_URL|RAGFLOW_API_KEY)=' "$EVAL_CONFIG" || true
    printf 'RAGFLOW_DATASETS=%s\n' "$DATASET_IDS"
  } > "$GOLDEN_CONFIG"
  chmod 600 "$GOLDEN_CONFIG"
fi
cd "$SOURCE_DIR"
if [[ -n "${NODE_BIN:-}" && -x "$NODE_BIN" ]]; then
  "$NODE_BIN" scripts/validate.mjs
else
  npm run validate
fi

rsync -a --delete \
  --exclude '.git/' \
  --exclude '_work/' \
  --exclude 'node_modules/' \
  --exclude 'deploy.log' \
  --exclude 'deploy.err.log' \
  --exclude 'DEPLOYED_SHA' \
  "$SOURCE_DIR/" "$APP_DIR/"
printf '%s\n' "$DEPLOY_SHA" > "$APP_DIR/DEPLOYED_SHA"

current_pid=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
if [[ -n "$current_pid" ]]; then
  kill $current_pid
  for _ in $(seq 1 20); do
    kill -0 "$current_pid" 2>/dev/null || break
    sleep 0.5
  done
fi

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$APP_DIR/editor/golden-server.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>GOLDEN_PORT</key><string>$GOLDEN_PORT</string>
    <key>BIND_ADDRESS</key><string>127.0.0.1</string>
    <key>GOLDEN_DATA_DIR</key><string>$DATA_DIR/golden-v1</string>
    <key>GOLDEN_CONFIG_FILE</key><string>$GOLDEN_CONFIG</string>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$APP_DIR/deploy.log</string>
  <key>StandardErrorPath</key><string>$APP_DIR/deploy.err.log</string>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/golden/state" >/dev/null 2>&1; then
    echo "DEPLOY_OK sha=$DEPLOY_SHA port=$PORT service=golden"
    curl -fsS "http://127.0.0.1:$PORT/api/golden/state" | "$NODE_BIN" -e "let b='';process.stdin.on('data',d=>b+=d).on('end',()=>{const s=JSON.parse(b);console.log('STATE queries='+s.queries.length+' facts='+s.facts.length+' evidences='+s.evidences.length+' claims='+(s.query_claims||[]).length)})"
    if [[ -n "$LAN_IP" ]]; then
      LAN_URL="http://${LAN_IP}:${PORT}/"
      if curl -fsS "http://${LAN_IP}:${PORT}/api/golden/state" >/dev/null 2>&1; then
        echo "LAN_URL=$LAN_URL"
        listener="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | tail -n +2 || true)"
        echo "LISTENER=$listener"
        if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
          printf '\n- LAN URL: `%s`\n' "$LAN_URL" >> "$GITHUB_STEP_SUMMARY"
        fi
      else
        echo "LAN_BIND_CHECK_FAILED interface=$LAN_INTERFACE ip=$LAN_IP port=$PORT"
        exit 1
      fi
    else
      echo "LAN_IP_UNAVAILABLE port=$PORT"
      exit 1
    fi
    exit 0
  fi
  sleep 1
done

echo "DEPLOY_FAILED health check"
tail -50 "$APP_DIR/deploy.err.log" 2>/dev/null || true
exit 1
