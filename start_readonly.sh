#!/bin/bash
# EWIS Forge — Read-only public server (0.0.0.0:5001)
# Exposed via Cloudflare tunnel. All write operations are blocked.
cd "$(dirname "$0")"
exec env FORGE_READONLY=1 /usr/bin/python3 server.py --no-browser
