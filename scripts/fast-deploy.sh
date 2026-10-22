#!/usr/bin/env bash
# Direct-upload deploy from the box to Cloudflare Pages (zaixi-blog). Usage: fast-deploy.sh [main|dev|both]
set -euo pipefail
cd "$(dirname "$0")/.."
export CLOUDFLARE_API_TOKEN="$(cat /home/box/.secrets/cf_pages_token)" CLOUDFLARE_ACCOUNT_ID="$(cat /home/box/.secrets/cf_account_id)"
export GITHUB_SHA="$(git rev-parse HEAD)"
prod() { pnpm build >/dev/null && python3 scripts/pages_deploy.py out zaixi-blog main; }
# dev needs its own build (site URL and noindex differ), so it builds into a copy.
dev() {
  NEXT_PUBLIC_SITE_URL=https://dev.zaixi.dev NEXT_PUBLIC_NOINDEX=true pnpm build >/dev/null
  printf '\n/*\n  X-Robots-Tag: noindex\n' >> out/_headers
  python3 scripts/pages_deploy.py out zaixi-blog dev
}
case "${1:-both}" in
  both) dev && prod ;;
  main) prod ;;
  dev) dev ;;
  *) echo "usage: $0 [main|dev|both]" >&2; exit 1 ;;
esac
