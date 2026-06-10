#!/bin/bash
# EWIS Forge — Cloudflare tunnel to the read-only server on port 5001.
# The URL assigned by Cloudflare is printed on startup — share it with viewers.
exec /opt/homebrew/bin/cloudflared tunnel --url http://localhost:5001
