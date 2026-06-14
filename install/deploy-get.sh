#!/usr/bin/env bash
#
# Deploy the get.spnr.sh installer host: a tiny nginx that serves install/get.sh,
# routed by the existing Dokploy Traefik (HTTP->HTTPS + Let's Encrypt) for the
# Host `get.spnr.sh`, on the attachable `dokploy-network`. Run on the deploy server
# (or build locally + `docker save | ssh … docker load`, then run this).
#
# Build first:  docker build -f install/Dockerfile.get -t spnr-get:latest install/
# Then run:     bash install/deploy-get.sh
#
# DNS required (point the hostname at the server, NOT a proxy):
#   A     get.spnr.sh  ->  <server-ip>     (Cloudflare: set to "DNS only" / grey cloud)
#   (remove any AAAA that points elsewhere, or point it at the server's IPv6)
set -uo pipefail

DOMAIN="${SPNR_GET_DOMAIN:-get.spnr.sh}"

docker rm -f spnr-get >/dev/null 2>&1 || true
docker run -d --name spnr-get --restart unless-stopped --network dokploy-network \
  --label traefik.enable=true \
  --label "traefik.http.routers.spnr-get-http.entrypoints=web" \
  --label "traefik.http.routers.spnr-get-http.rule=Host(\`${DOMAIN}\`)" \
  --label "traefik.http.routers.spnr-get-http.middlewares=redirect-to-https@file" \
  --label "traefik.http.routers.spnr-get.entrypoints=websecure" \
  --label "traefik.http.routers.spnr-get.rule=Host(\`${DOMAIN}\`)" \
  --label "traefik.http.routers.spnr-get.tls=true" \
  --label "traefik.http.routers.spnr-get.tls.certresolver=letsencrypt" \
  --label "traefik.http.services.spnr-get.loadbalancer.server.port=80" \
  spnr-get:latest

echo "deployed spnr-get for https://${DOMAIN}"
echo "once DNS -> this server, Traefik issues the cert automatically; verify with:"
echo "  curl -fsSL https://${DOMAIN} | head -1"
