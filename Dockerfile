# syntax=docker/dockerfile:1
#
# LoreRoom — container image for MCP directory listing / introspection (e.g. Glama).
#
# It builds the project, generates a THROWAWAY local config (a random key and an
# empty encrypted DB), and starts the MCP server over stdio so it answers tool
# introspection (`tools/list`). No real data and no secrets are baked into the image.
#
# This image exists only so directories can verify the server starts and exposes
# its tools. For real use, run LoreRoom locally as the README describes, so your
# encrypted memory database stays on your own machine.

FROM node:22-bookworm

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Compile TypeScript -> dist/.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Generate a throwaway config (random 32-byte key) + empty encrypted DB so the
# server can start and answer introspection. Nothing sensitive is persisted.
RUN node dist/cli.js init

# The MCP server speaks over stdio.
CMD ["node", "dist/mcp-server.js"]
