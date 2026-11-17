import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { TelegramClient } from 'teleproto'
import { StringSession } from 'teleproto/sessions/index.js'
import { collectSessionInput } from './session-input.js'

const sessionFile = new URL('../.telegram/github-actions-session.txt', import.meta.url)

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Chạy npm run telegram:actions-session trực tiếp trong terminal để nhập mã đăng nhập Telegram.')
  }
  if (existsSync(sessionFile)) {
    throw new Error('Đã có .telegram/github-actions-session.txt. Hãy đổi tên file đó trước khi tạo session mới; lệnh này không ghi đè session đã có.')
  }

  const envFile = new URL('../.env.telegram.local', import.meta.url)
  if (existsSync(envFile)) process.loadEnvFile(fileURLToPath(envFile))
  else console.log('Chưa có file cấu hình. Chương trình sẽ hỏi từng thông tin; nhập xong mỗi ô thì nhấn Enter.')

  let muted = false
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding)
      callback()
    },
  })
  const terminal = createInterface({ input: process.stdin, output, terminal: true })
  const cancellation = new AbortController()
  terminal.on('SIGINT', () => cancellation.abort())
  async function ask(label, hidden = false) {
    // Let readline own the prompt so typing/pasting cannot erase its label.
    muted = false
    const answer = terminal.question(label, { signal: cancellation.signal })
    muted = hidden
    try {
      return (await answer).trim()
    } finally {
      muted = false
      if (hidden) process.stdout.write('\n')
    }
  }

  let client
  try {
    const { apiId, apiHash, phone } = await collectSessionInput({
      env: process.env,
      ask,
      onInvalid: (message) => console.log(message),
      onValid: (name) => {
        if (name === 'apiHash') console.log('Đã nhận API Hash đúng định dạng (32 ký tự).')
      },
    })

    // Always start with a new auth key; never import the local listener session.
    client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 3 })
    await client.start({
      phoneNumber: async () => phone,
      phoneCode: async () => ask('Mã đăng nhập trong Telegram (ẩn): ', true),
      password: async () => ask('Mật khẩu xác minh 2 bước, nếu có (ẩn): ', true),
      onError: (error) => { throw error },
    })
    const session = client.session.save()
    if (!session) throw new Error('Không tạo được session Telegram.')

    // Disconnect before the session can be handed to GitHub's runner.
    await client.disconnect()
    client = null
    await mkdir(new URL('../.telegram/', import.meta.url), { recursive: true })
    await writeFile(sessionFile, session, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    console.log('Đã tạo .telegram/github-actions-session.txt và ngắt kết nối Telegram.')
    console.log('Chỉ dùng file này cho GitHub Actions: cập nhật repository secret TELEGRAM_SESSION bằng nội dung file.')
    console.log('Không dùng session này cho listener local. Session không được in ra terminal hoặc đưa vào Git.')
  } finally {
    terminal.close()
    if (client) await client.disconnect().catch(() => {})
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error.name === 'AbortError' ? 'Đã hủy tạo session.' : error.message)
  process.exit(1)
})
