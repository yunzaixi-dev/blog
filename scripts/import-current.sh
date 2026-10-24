#!/bin/sh
set -eu
exec /app/dist/blog --mode=import --checkout-root=/data/git/current --worker=/app/dist/worker/content-worker.mjs
