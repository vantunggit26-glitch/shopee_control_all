import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { describeTelegramFailure, escapeAnnotation } from './telegram-errors.js'

test('recognizes both RPC code and actual production session-duplication message', () => {
  for (const error of [
    { errorMessage: 'AUTH_KEY_DUPLICATED' },
    new Error('Concurrent usage of the current session from multiple connections was detected, the current session was invalidated by the server for security reasons! (caused by InvokeWithLayer)'),
  ]) {
    const result = describeTelegramFailure(error)
    assert.match(result.message, /telegram:actions-session/)
    assert.match(result.message, /TELEGRAM_SESSION/)
    assert.match(result.message, /Re-run/)
  }
})

test('expired/revoked sessions give a login instruction; network errors are not misdiagnosed', () => {
  for (const errorMessage of ['SESSION_REVOKED', 'AUTH_KEY_UNREGISTERED', 'SESSION_EXPIRED']) {
    assert.match(describeTelegramFailure({ errorMessage }).message, /đăng nhập Telegram lại/)
  }
  assert.equal(describeTelegramFailure(new Error('ECONNRESET')).message, 'ECONNRESET')
})

test('escapes multiline annotations so error messages cannot inject workflow commands', () => {
  assert.equal(escapeAnnotation('50%\r\n::warning::test'), '50%25%0D%0A::warning::test')
})

test('missing configuration fails before connecting Telegram and gives an Actions annotation', () => {
  const env = { ...process.env, GITHUB_ACTIONS: 'true' }
  for (const name of ['TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'TELEGRAM_SESSION', 'GOOGLE_APPLICATION_CREDENTIALS', 'GITHUB_STEP_SUMMARY']) delete env[name]
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./run-once.js', import.meta.url))], { env, encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /::error title=/)
  assert.match(result.stderr, /TELEGRAM_SESSION/)
  assert.doesNotMatch(result.stdout, /Starting|Connecting/)
})

test('session generator refuses non-interactive runs before attempting Telegram login', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./create-actions-session.js', import.meta.url))], { encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /telegram:actions-session/)
})
