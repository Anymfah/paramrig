FROM node:22-bookworm-slim

WORKDIR /workspace
RUN chown -R node:node /workspace
USER node

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node packages/core/package.json ./packages/core/package.json
COPY --chown=node:node packages/audio/package.json ./packages/audio/package.json
COPY --chown=node:node packages/audio-labs/package.json ./packages/audio-labs/package.json
COPY --chown=node:node packages/audio-browser/package.json ./packages/audio-browser/package.json
COPY --chown=node:node packages/vector/package.json ./packages/vector/package.json
COPY --chown=node:node packages/scene/package.json ./packages/scene/package.json
COPY --chown=node:node packages/controls/package.json ./packages/controls/package.json
COPY --chown=node:node packages/web-sdk/package.json ./packages/web-sdk/package.json
RUN npm ci --no-audit --no-fund
