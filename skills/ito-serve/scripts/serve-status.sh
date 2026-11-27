#!/usr/bin/env bash
# ito-serve: stream the live state of a self-hosted inference deployment on
# Itô-reserved nodes. Reads real telemetry from the reserved fleet; it does
# not fabricate. Nodes and endpoint are passed in, nothing is hard-coded to a
# single deployment.
set -euo pipefail

NODES="${ITO_SERVE_NODES:?set ITO_SERVE_NODES to a space-separated list of node IPs}"
ENDPOINT="${ITO_SERVE_ENDPOINT:-http://localhost:30000}"
MODEL="${ITO_SERVE_MODEL:-the served checkpoint}"
RATE="${ITO_SERVE_RATE:-fixed rate (see reservation)}"

hr() { printf '%s\n' "----------------------------------------------------------------"; }

hr
printf 'ito-serve  |  model: %s  |  block held at: %s\n' "$MODEL" "$RATE"
hr

i=0
for n in $NODES; do
  i=$((i + 1))
  printf '\n[node %d] %s  GPU / HBM occupancy\n' "$i" "$n"
  ssh -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new "root@$n" \
    'nvidia-smi --query-gpu=index,name,memory.used,memory.total,utilization.gpu \
       --format=csv,noheader | sed "s/^/    gpu /"' \
    || printf '    (node unreachable)\n'
  printf '  fabric rails up on this node: '
  ssh -o ConnectTimeout=8 "root@$n" \
    'ip -br addr | grep -c "172\.16\."' 2>/dev/null || printf '?'
  printf ' / 8\n'
done

hr
printf 'served endpoint health: '
if curl -s -o /dev/null -w '%{http_code}' "${ENDPOINT}/health" 2>/dev/null | grep -q 200; then
  printf 'HEALTHY (%s)\n' "$ENDPOINT"
  printf 'models loaded:\n'
  curl -s "${ENDPOINT}/v1/models" 2>/dev/null | python3 -m json.tool 2>/dev/null | sed 's/^/    /' \
    || printf '    (model list unavailable)\n'
else
  printf 'not yet serving (endpoint not healthy)\n'
fi
hr
