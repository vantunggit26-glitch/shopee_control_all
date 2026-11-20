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

function setupManualTest(feed, quota = 100) {
  const settings = {
    startsAt: 300, enabled: false, keyword: 'Mã người mới giảm', emails: ['first@gmail.com', 'second@gmail.com'],
  }
  const sent = []
  const logs = []
  const sendLatestVoucherTest = runInNewContext(code + '\n;sendLatestVoucherTest', {
    console: { log: line => logs.push(line) },
    UrlFetchApp: {
      fetch(url, options) {
        const runner = url.endsWith('/runner')
        assert.equal(options.headers.Authorization, runner ? 'Bearer test-token' : undefined)
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(runner ? { settings } : { feed }) }
      },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'test-token' }) },
    MailApp: { getRemainingDailyQuota: () => quota, sendEmail: (...args) => sent.push(args) },
  })
  return { sendLatestVoucherTest, settings, sent, logs }
}

test('manual test emails only the latest matching item in an unsorted feed even if before activation or alerts are off', () => {
  const { sendLatestVoucherTest, settings, sent, logs } = setupManualTest([
    { publishedAt: 250, id: 'older', title: 'Mã người mới giảm 50K' },
    { publishedAt: 299, id: 'other', title: 'Mã cho mọi tài khoản' },
    { publishedAt: 280, id: 'latest', title: '📌 MÃ Người mới  giảm 100K', links: ['https://vouchersan.com/link/match/'] },
    { publishedAt: 201, id: 'oldest', title: 'Mã người mới giảm 20K' },
  ])

  sendLatestVoucherTest()
  assert.deepEqual(sent.map(message => message[0]), settings.emails)
  for (const [, subject, body] of sent) {
    assert.match(subject, /Gửi thử: Mã người mới giảm/)
    assert.match(body, /100K/)
    assert.match(body, /https:\/\/vouchersan\.com\/link\/match\//)
    assert.doesNotMatch(body, /50K|20K|mọi tài khoản/)
  }
  assert.match(logs[0], /2 địa chỉ Gmail/)
})

test('manual test sends no mail when no voucher matches or quota is insufficient', () => {
  const noMatch = setupManualTest([{ publishedAt: 280, id: 'other', title: 'Mã cho mọi tài khoản' }])
  noMatch.sendLatestVoucherTest()
  assert.equal(noMatch.sent.length, 0)
  assert.match(noMatch.logs[0], /Không tìm thấy tin/)

  const lowQuota = setupManualTest([{ publishedAt: 280, id: 'match', title: 'Mã người mới giảm 100K' }], 1)
  assert.throws(lowQuota.sendLatestVoucherTest, /Hạn mức gửi email/)
  assert.equal(lowQuota.sent.length, 0)
})
