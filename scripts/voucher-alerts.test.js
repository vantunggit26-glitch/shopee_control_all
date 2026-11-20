import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const code = readFileSync(new URL('../public/voucher-alerts.gs', import.meta.url), 'utf8')

test('the existing Apps Script trigger uses saved settings, sends only matching new items and tracks each Gmail', () => {
  const props = { ACCOUNT_VAULT_ALERT_CODE: 'test-token' }
  const settings = {
    startsAt: 200, enabled: true, keyword: 'Mã người mới giảm', emails: ['first@gmail.com', 'second@gmail.com'],
  }
  const sent = []
  const feed = [
    { publishedAt: 199, id: 'old', title: 'Mã người mới giảm cũ' },
    { publishedAt: 201, id: 'match', title: '📌 MÃ Người mới  giảm 100K', links: ['https://vouchersan.com/link/match/'] },
    { publishedAt: 202, id: 'other', title: 'Mã cho mọi tài khoản' },
  ]
  const app = runInNewContext(code + '\n;({ checkVouchers, installAlerts })', {
    console: { log() {} },
    UrlFetchApp: {
      fetch(url, options) {
        const runner = url.endsWith('/runner')
        if (runner) assert.equal(options.headers.Authorization, 'Bearer test-token')
        else assert.equal(options.headers.Authorization, undefined)
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(runner ? { settings } : { feed }) }
      },
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => props[key], getProperties: () => ({ ...props }),
      setProperties: values => Object.assign(props, values), deleteProperty: key => delete props[key],
    }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ScriptApp: { getProjectTriggers: () => [{ getHandlerFunction: () => 'checkVouchers' }] },
    MailApp: { getRemainingDailyQuota: () => 100, sendEmail: (...args) => sent.push(args) },
  })

  app.installAlerts()
  app.checkVouchers()
  app.checkVouchers()
  assert.deepEqual(sent.map(message => message[0]), settings.emails)
  assert.match(sent[0][2], /100K/)
  assert.doesNotMatch(sent[0][2], /cũ|mọi tài khoản/)

  settings.enabled = false
  feed.push({ publishedAt: 203, id: 'muted', title: 'Mã người mới giảm 20K' })
  app.checkVouchers()
  assert.equal(sent.length, 2)
})
