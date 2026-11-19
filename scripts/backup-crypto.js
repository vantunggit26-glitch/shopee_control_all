import { createCipheriv, createDecipheriv, pbkdf2, randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { promisify } from 'node:util'

const magic = Buffer.from('AVBK2\0')
const derive = promisify(pbkdf2)
const iterations = 600_000
const saltSize = 16
const ivSize = 12
const tagSize = 16
const headerSize = magic.length + saltSize + ivSize

export function isEncryptedBackup(buffer) {
  return buffer.subarray(0, magic.length).equals(magic)
}

export async function encryptBackup(compressed, passphrase) {
  const salt = randomBytes(saltSize)
  const iv = randomBytes(ivSize)
  const key = await derive(passphrase, salt, iterations, 32, 'sha256')
  try {
    const header = Buffer.concat([magic, salt, iv])
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(header)
    const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()])
    return Buffer.concat([header, cipher.getAuthTag(), encrypted])
  } finally {
    key.fill(0)
  }
}

export async function decryptBackup(buffer, passphrase) {
  if (!isEncryptedBackup(buffer) || buffer.length <= headerSize + tagSize) {
    throw new Error('Định dạng backup mã hóa không hợp lệ.')
  }
  const header = buffer.subarray(0, headerSize)
  const salt = header.subarray(magic.length, magic.length + saltSize)
  const iv = header.subarray(magic.length + saltSize)
  const key = await derive(passphrase, salt, iterations, 32, 'sha256')
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(header)
    decipher.setAuthTag(buffer.subarray(headerSize, headerSize + tagSize))
    return Buffer.concat([decipher.update(buffer.subarray(headerSize + tagSize)), decipher.final()])
  } catch {
    throw new Error('Mật khẩu backup sai hoặc file đã bị thay đổi.')
  } finally {
    key.fill(0)
  }
}

export async function readBackupPassphrase(confirm = false) {
  const environmentSecret = process.env.ACCOUNT_VAULT_BACKUP_PASSWORD
  if (environmentSecret !== undefined) {
    if (environmentSecret.length < 12) throw new Error('Mật khẩu backup cần ít nhất 12 ký tự.')
    return environmentSecret
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Mở terminal tương tác để nhập mật khẩu backup hoặc cấp ACCOUNT_VAULT_BACKUP_PASSWORD qua môi trường riêng.')
  }
  const hidden = new Writable({ write(_data, _encoding, done) { done() } })
  const terminal = createInterface({ input: process.stdin, output: hidden, terminal: true })
  const cancellation = new AbortController()
  terminal.on('SIGINT', () => cancellation.abort())
  async function ask(label) {
    process.stdout.write(label)
    try {
      return await terminal.question('', { signal: cancellation.signal })
    } finally {
      process.stdout.write('\n')
    }
  }
  try {
    const value = await ask('Mật khẩu backup (nhập ẩn): ')
    if (value.length < 12) throw new Error('Mật khẩu backup cần ít nhất 12 ký tự.')
    if (confirm && await ask('Nhập lại mật khẩu backup (nhập ẩn): ') !== value) {
      throw new Error('Hai mật khẩu backup chưa trùng nhau.')
    }
    return value
  } finally {
    terminal.close()
  }
}
