#!/bin/bash
# Print the current Cloudflare tunnel URL for the read-only Forge dashboard.
URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' \
  "$(dirname "$0")/logs/tunnel.err" \
  "$(dirname "$0")/logs/cloudflared.log" 2>/dev/null | tail -1)

if [ -z "$URL" ]; then
  echo "Tunnel URL not found yet. Check logs/tunnel.err"
else
  echo "FORGE READ-ONLY URL: $URL"
fi
