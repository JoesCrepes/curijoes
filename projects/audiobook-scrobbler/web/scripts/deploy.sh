#!/usr/bin/env bash
# Push .env.local to a Vercel project and deploy.
#
#   npx vercel login                       # once, interactive browser flow
#   bash scripts/deploy.sh <project-name>  # link, upload env, deploy to production
#
# Pass the existing Vercel project's name so this links to it instead of
# creating a second one; `vercel project ls` lists them.
#
# Env values are read from .env.local and piped in, so nothing is echoed and
# nothing ends up in shell history. Re-running is safe: each variable is
# removed before it is re-added.
set -euo pipefail
cd "$(dirname "$0")/.."

# Use a globally installed CLI when there is one, otherwise npx.
if command -v vercel >/dev/null 2>&1; then
  vercel() { command vercel "$@"; }
else
  vercel() { npx --yes vercel@latest "$@"; }
fi

VARS=(SUPABASE_URL SUPABASE_SECRET_KEY API_TOKEN CRON_SECRET HARDCOVER_TOKEN HARDCOVER_DRY_RUN)
ENVS=(production preview)

if [ ! -f .env.local ]; then
  echo ".env.local not found" >&2
  exit 1
fi

vercel whoami >/dev/null 2>&1 || { echo "not logged in — run: npx vercel login" >&2; exit 1; }

echo "== linking =="
if [ -n "${1:-}" ]; then
  vercel link --yes --project "$1"
else
  vercel link --yes
fi

echo "== environment =="
for v in "${VARS[@]}"; do
  value="$(grep -E "^${v}=" .env.local | head -1 | cut -d= -f2-)"
  if [ -z "$value" ]; then
    echo "  skip $v (empty in .env.local)"
    continue
  fi
  for e in "${ENVS[@]}"; do
    vercel env rm "$v" "$e" --yes >/dev/null 2>&1 || true
    printf '%s' "$value" | vercel env add "$v" "$e" >/dev/null
  done
  echo "  set $v (production, preview)"
done

echo "== deploying =="
vercel deploy --prod

echo
echo "Scheduled jobs actually registered:"
vercel crons ls || true
echo
echo "Now verify the deployment: curl -s -H \"Authorization: Bearer \$API_TOKEN\" <url>/api/dashboard"
