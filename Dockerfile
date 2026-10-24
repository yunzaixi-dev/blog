FROM node:24-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec vite build && pnpm exec vite build --config vite.worker.config.ts

FROM golang:1.26-bookworm AS go-build
WORKDIR /app
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -o /blog ./cmd/blog

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/worker ./dist/worker
COPY --from=build /app/out ./out
COPY --from=go-build /blog ./dist/blog
RUN mkdir -p /content /media && chown -R node:node /app /content /media
USER node
EXPOSE 45101
VOLUME ["/content", "/media"]
ENTRYPOINT ["./dist/blog", "--addr", "0.0.0.0:45101", "--content", "/content", "--media", "/media"]
