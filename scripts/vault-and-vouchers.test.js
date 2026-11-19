import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createVault, openVaultValue, sealVaultValue, unlockVault } from '../src/vaultCrypto.js'
import { matchesOfferFilter, uniqueVouchers, voucherExpiry, voucherText } from '../src/voucherUtils.js'
import { decryptBackup, encryptBackup, isEncryptedBackup } from './backup-crypto.js'

test('vault opens across sessions with the same passphrase and rejects mismatched contexts', async () => {
  const password = 'mat-khau-thu-nghiem-123'
  const { key, settings } = await createVault(password, 'user-a')
  const context = 'user-a/credentials/site-a'
  const value = { siteName: 'Mẫu', url: 'https://example.com', username: 'user', password: 'example' }
  const record = await sealVaultValue(key, value, context)
  assert.notEqual((await sealVaultValue(key, value, context)).iv, record.iv)
  const reopened = await unlockVault(password, 'user-a', settings)
  assert.deepEqual(await openVaultValue(reopened, record, context), value)
  await assert.rejects(openVaultValue(reopened, record, 'user-a/credentials/site-b'))
  await assert.rejects(unlockVault('mat-khau-sai-123', 'user-a', settings))
})

test('backup ciphertext round-trips and detects modifications', async () => {
  const sample = Buffer.from('example snapshot data')
  const passphrase = 'test-backup-passphrase'
  const encrypted = await encryptBackup(sample, passphrase)
  assert.ok(isEncryptedBackup(encrypted))
  assert.deepEqual(await decryptBackup(encrypted, passphrase), sample)
  encrypted[encrypted.length - 1] ^= 1
  await assert.rejects(decryptBackup(encrypted, passphrase), /sai hoặc file/)
})

test('voucher filters understand explicit zero-order and expiry without using message retention', () => {
  const now = Date.parse('2026-11-19T12:00+07:00')
  assert.equal(matchesOfferFilter('zero', 'Voucher 80K/0Đ', null, now), true)
  assert.equal(matchesOfferFilter('zero', 'Đơn 0đ · Giảm 50K', null, now), true)
  assert.equal(matchesOfferFilter('zero', 'Giảm cho đơn từ 120K', null, now), false)
  assert.equal(matchesOfferFilter('expiring', '', voucherExpiry('HSD 19/11/2026'), now), true)
  assert.equal(matchesOfferFilter('expiring', '', voucherExpiry('Tin được lưu 5 ngày'), now), false)
  assert.equal(voucherExpiry('HSD 31/02/2026'), null)
  assert.deepEqual(uniqueVouchers(['MÃ 80K', 'Mã   80K', 'Mã 100K'], voucherText), ['MÃ 80K', 'Mã 100K'])
})
