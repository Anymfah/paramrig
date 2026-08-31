FROM node:22-bookworm-slim

WORKDIR /workspace
RUN chown -R node:node /workspace
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
