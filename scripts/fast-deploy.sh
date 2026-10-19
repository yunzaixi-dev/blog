#!/usr/bin/env bash
# Direct-upload deploy from the box to Cloudflare Pages (zaixi-blog). Usage: fast-deploy.sh [main|dev|both]
set -euo pipefail
cd "$(dirname "$0")/.."
export CLOUDFLARE_API_TOKEN="$(cat /home/box/.secrets/cf_pages_token)" CLOUDFLARE_ACCOUNT_ID="$(cat /home/box/.secrets/cf_account_id)"
export GITHUB_SHA="$(git rev-parse HEAD)"
rm -rf public && hugo --minify --quiet
case "${1:-both}" in
  both) python3 scripts/pages_deploy.py public zaixi-blog main & python3 scripts/pages_deploy.py public zaixi-blog dev & wait ;;
  *) python3 scripts/pages_deploy.py public zaixi-blog "$1" ;;
esac
