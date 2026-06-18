# Multi-stage build: compile the community node package, then bake it into n8n.
#
# The node is installed to /opt/n8n-nodes (NOT under ~/.n8n) and exposed via
# N8N_CUSTOM_EXTENSIONS, so a persisted /home/node/.n8n data volume cannot shadow
# or stale-cache the nodes.

# ---- build stage: compile dist/ and produce a tarball -----------------------
FROM node:20-alpine AS build
WORKDIR /pkg
COPY package.json tsconfig.json index.js ./
COPY nodes ./nodes
COPY credentials ./credentials
RUN npm install --no-audit --no-fund \
 && npm run build \
 && npm pack

# ---- runtime: n8n with the package as a custom extension --------------------
FROM n8nio/n8n:latest
USER root
COPY --from=build /pkg/n8n-nodes-unifi-*.tgz /tmp/pkg.tgz
RUN mkdir -p /opt/n8n-nodes \
 && tar -xzf /tmp/pkg.tgz -C /opt/n8n-nodes --strip-components=1 \
 && rm /tmp/pkg.tgz \
 && chown -R node:node /opt/n8n-nodes
USER node
ENV N8N_CUSTOM_EXTENSIONS=/opt/n8n-nodes
