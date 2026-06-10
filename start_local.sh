#!/bin/bash
# EWIS Forge — Local full-access server (127.0.0.1:5000)
# Used for local operation and MCP/chat interaction.
cd "$(dirname "$0")"
exec /usr/bin/python3 server.py --no-browser
