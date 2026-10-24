FROM golang:1.26.10-bookworm AS go
FROM node:24-bookworm
COPY --from=go /usr/local/go /usr/local/go
ENV PATH=/usr/local/go/bin:/home/node/go/bin:$PATH
ENV npm_config_store_dir=/home/node/.local/share/pnpm/store
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates curl postgresql-client python3 sudo \
    && rm -rf /var/lib/apt/lists/*
RUN printf 'node ALL=(root) NOPASSWD:ALL\n' > /etc/sudoers.d/node && chmod 0440 /etc/sudoers.d/node
USER node
WORKDIR /workspaces/blog
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile && pnpm exec playwright install --with-deps chromium
COPY --chown=node:node go.mod go.sum ./
RUN go mod download
USER root
RUN apt-get update && apt-get install -y --no-install-recommends jq && rm -rf /var/lib/apt/lists/*
USER node
CMD ["sleep", "infinity"]
