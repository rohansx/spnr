#!/usr/bin/env bash
#
# Deploy the spnr demand-side portal (server-ts): the /v2 campaigns/auction API +
# the server-rendered /admin operator panel. Run on the deploy server after
# building + loading the image:
#
#   docker build -f server-ts/Dockerfile -t spnr-portal:latest server-ts/
#   docker save spnr-portal:latest | gzip | ssh root@SERVER 'gunzip | docker load'
#   ssh root@SERVER 'bash -s' < install/deploy-portal.sh
#
# The admin panel reads the Rust backend's /api/stats + /v1/serve. The host firewall
# blocks container->host-published-port, so we put both containers on a shared
# user-defined network and talk by container name (SPNR_BACKEND=http://spnr-server:8787).
set -uo pipefail

BACKEND_CONTAINER="${SPNR_BACKEND_CONTAINER:-spnr-server}"
NET="${SPNR_NET:-spnr-net}"
PORT="${SPNR_PORTAL_PORT:-8790}"

docker network create "$NET" >/dev/null 2>&1 || true
# Attach the (already-running) backend to the shared net so the portal resolves it by name.
docker network connect "$NET" "$BACKEND_CONTAINER" >/dev/null 2>&1 || true

docker rm -f spnr-portal >/dev/null 2>&1 || true
docker run -d --name spnr-portal --restart unless-stopped \
  --network "$NET" -p "${PORT}:8790" -v spnr-portal-data:/data \
  -e "SPNR_BACKEND=http://${BACKEND_CONTAINER}:8787" \
  spnr-portal:latest

sleep 2
echo "portal: $(docker ps --filter name=spnr-portal --format '{{.Status}}')"
echo "health: $(curl -fsS http://127.0.0.1:${PORT}/health 2>/dev/null)"
echo "admin : http://<server>:${PORT}/admin  (serving pool + campaigns + network stats)"
echo "api   : http://<server>:${PORT}/v2/campaigns"
