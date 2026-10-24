FROM node:24-bookworm-slim AS build
RUN corepack enable && corepack install --global pnpm@11.3.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec vite build && pnpm exec vite build --config vite.worker.config.ts

FROM golang:1.26.10-bookworm AS go-build
WORKDIR /app
COPY go.mod ./
COPY go.sum ./
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -o /blog ./cmd/blog

FROM registry.k8s.io/git-sync/git-sync@sha256:a20644562fba94773e594885cb001aadb5a3172175f13ac1215e5b2033c9200e AS git-sync
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/worker ./dist/worker
COPY --from=build /app/out ./out
COPY --from=go-build /blog ./dist/blog
COPY --from=git-sync /git-sync /usr/local/bin/git-sync
COPY scripts/import-current.sh /app/scripts/import-current.sh
RUN mkdir -p /content /media && chmod 0755 /app/scripts/import-current.sh && chown -R node:node /app /content /media
USER node
EXPOSE 45101
VOLUME ["/content", "/media"]
ENTRYPOINT ["./dist/blog", "--addr", "0.0.0.0:45101", "--content", "/content", "--media", "/media"]
