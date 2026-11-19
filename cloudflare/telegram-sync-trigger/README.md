# Telegram sync trigger Worker

This Worker accepts an authenticated request from the Account Vault UI and
triggers `.github/workflows/telegram-hourly-sync.yml` through GitHub's
`workflow_dispatch` API.

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
