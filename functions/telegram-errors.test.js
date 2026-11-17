import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { describeTelegramFailure, escapeAnnotation } from './telegram-errors.js'
import { collectSessionInput } from './session-input.js'

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

test('invalid API ID is retried before asking for the hidden API Hash', async () => {
  const answers = ['clip < .telegram/github-actions-session.txt', '', '123456', 'wrong-hash', 'a'.repeat(32), 'not-a-phone', '0901234567']
  const prompts = []
  const invalid = []
  const result = await collectSessionInput({
    ask: async (label, hidden) => { prompts.push({ label, hidden }); return answers.shift() },
    onInvalid: (message) => invalid.push(message),
  })
  assert.equal(result.apiId, 123456)
  assert.equal(result.apiHash, 'a'.repeat(32))
  assert.equal(result.phone, '+84901234567')
  assert.ok(prompts.slice(0, 3).every(({ label }) => label.startsWith('[1/3]')))
  assert.ok(prompts.slice(3, 5).every(({ hidden }) => hidden))
  assert.equal(invalid.length, 4)
})

test('valid environment inputs need no prompts; invalid configured inputs can be corrected', async () => {
  const result = await collectSessionInput({
    env: { TELEGRAM_API_ID: '123456', TELEGRAM_API_HASH: 'B'.repeat(32), TELEGRAM_PHONE: '+84 901 234 567' },
    ask: async () => { throw new Error('Must not prompt') },
  })
  assert.equal(result.phone, '+84901234567')
  const answers = ['789012', 'c'.repeat(32), '84901234567']
  const corrected = await collectSessionInput({
    env: { TELEGRAM_API_ID: '1e6', TELEGRAM_API_HASH: 'placeholder', TELEGRAM_PHONE: 'wrong' },
    ask: async () => answers.shift(),
  })
  assert.equal(corrected.apiId, 789012)
  assert.equal(corrected.phone, '+84901234567')
})
