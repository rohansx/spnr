# spnr demand-side portal (Express + TS): /v2 campaigns/auction API + /admin panel.
# Multi-stage: compile TS, then a slim prod runtime. Build context = server-ts/.
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Container defaults: durable JSON store on a volume; read network stats from the
# deployed Rust backend for the admin panel. Override SPNR_BACKEND at run time.
ENV PORT=8790 \
    SPNR_PORTAL_DB=/data/portal-store.json \
    SPNR_BACKEND=http://82.112.226.62:8787
VOLUME ["/data"]
EXPOSE 8790
CMD ["node", "dist/server.js"]
