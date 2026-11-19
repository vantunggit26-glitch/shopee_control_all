# Telegram sync trigger Worker

This Worker triggers `.github/workflows/telegram-hourly-sync.yml` through
GitHub's `workflow_dispatch` API every 20 minutes at :07, :27, and :47 UTC.
It also accepts authenticated requests from the Account Vault UI. Both paths
skip dispatch when a recent run is queued or running. The workflow's
concurrency group serializes any requests that arrive at the same time.
Scheduled dispatch outcomes are available in Cloudflare Workers Observability.

Security boundaries:

- Firebase Auth verifies the caller's current ID token.
- Only `tungtv@account.com` may trigger the workflow.
- `GITHUB_TOKEN` is a Cloudflare Worker Secret and must never be committed.
- The token should be fine-grained, scoped only to this repository, with
  `Actions: Read and write` permission.
- Requests are accepted only from configured web origins.

Deployment:

1. Run `npx -y wrangler@latest login`.
2. Run `npx -y wrangler@latest secret put GITHUB_TOKEN --config cloudflare/telegram-sync-trigger/wrangler.jsonc`.
3. Run `npx -y wrangler@latest deploy --config cloudflare/telegram-sync-trigger/wrangler.jsonc`.
4. Set `VITE_TELEGRAM_SYNC_TRIGGER_URL` to the deployed `/trigger` URL and
   rebuild/deploy Firebase Hosting.
