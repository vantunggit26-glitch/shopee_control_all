import { mkdir, readFile, writeFile } from 'node:fs/promises'
import input from 'input'
import { TelegramClient } from 'teleproto'
import { StringSession } from 'teleproto/sessions/index.js'
import { createTodoRepository } from './firebase-todo.js'

const sessionDirectory = new URL('../.telegram/', import.meta.url)
const sessionFile = new URL('../.telegram/session.txt', import.meta.url)
const configurationFile = new URL('../telegram-listener.config.json', import.meta.url)

function requiredEnvironment(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Thiếu ${name} trong file .env.telegram.local`)
  return value
}

async function readSession() {
  try {
    return (await readFile(sessionFile, 'utf8')).trim()
  } catch (error) {
    if (error.code === 'ENOENT') return ''
    throw error
  }
}

async function saveSession(session) {
  await mkdir(sessionDirectory, { recursive: true })
  await writeFile(sessionFile, session, { encoding: 'utf8', mode: 0o600 })
}

function getSenderName(sender) {
  if (!sender) return 'Không rõ người gửi'
  if (sender.username) return `@${sender.username}`

  const fullName = [sender.firstName, sender.lastName].filter(Boolean).join(' ').trim()
  return fullName || sender.title || String(sender.id || 'Không rõ người gửi')
}

function formatMessageDate(value) {
  const date = toMessageDate(value)
  return Number.isNaN(date.getTime()) ? new Date().toLocaleString('vi-VN') : date.toLocaleString('vi-VN')
}

function toMessageDate(value) {
  const date = value instanceof Date ? value : new Date(Number(value) * 1000)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function normalizeForSearch(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('vi')
}

async function readConfiguration() {
  const configuration = JSON.parse(await readFile(configurationFile, 'utf8'))
  const targetChat = process.env.TELEGRAM_TARGET_CHAT?.trim() || String(configuration.targetChat || '').trim()
  const filterKeyword = process.env.TELEGRAM_FILTER_KEYWORD?.trim() || String(configuration.filterKeyword || '').trim()
  const firestoreCollection = String(configuration.firestoreCollection || '').trim()

  if (!targetChat) throw new Error('Thiếu targetChat trong telegram-listener.config.json.')
  if (!filterKeyword) throw new Error('Thiếu filterKeyword trong telegram-listener.config.json.')
  if (!firestoreCollection) throw new Error('Thiếu firestoreCollection trong telegram-listener.config.json.')

  return { targetChat, filterKeyword, firestoreCollection }
}

function normalizeTelegramTarget(value) {
  const target = value.trim()
  if (!/^https?:\/\//i.test(target)) return target

  const url = new URL(target)
  if (url.hostname !== 't.me' && url.hostname !== 'www.t.me') {
    throw new Error('Link nhóm phải thuộc tên miền t.me.')
  }

  const pathParts = url.pathname.split('/').filter(Boolean)
  if (pathParts[0] === 's') pathParts.shift()
  const username = pathParts[0]
  if (!username || username.startsWith('+') || username === 'joinchat') {
    throw new Error('Link mời riêng tư chưa được hỗ trợ. Hãy tham gia nhóm trước rồi chọn từ danh sách.')
  }

  return `@${username}`
}

async function resolveTarget(client, value) {
  const normalizedTarget = normalizeTelegramTarget(value)
  const entity = await client.getEntity(normalizedTarget)
  const label = entity.title || entity.username || normalizedTarget
  return {
    chatTitle: entity.title || label,
    chatUsername: entity.username || normalizedTarget.replace(/^@/, ''),
    label,
    watchTarget: normalizedTarget,
  }
}

async function chooseTargetGroup(client, configuredTarget) {
  if (configuredTarget) return resolveTarget(client, configuredTarget)

  const dialogs = await client.getDialogs({ limit: 200 })
  const groupAndChannelDialogs = dialogs.filter((dialog) => dialog.isGroup || dialog.isChannel)

  console.log('\nCác nhóm và kênh tài khoản đang truy cập được:')
  groupAndChannelDialogs.forEach((dialog, index) => {
    const type = dialog.isGroup ? 'Nhóm' : 'Kênh'
    console.log(`${index + 1}. [${type}] ${dialog.title} | ID: ${dialog.id}`)
  })

  const selection = await input.text('\nNhập số thứ tự, link t.me hoặc @username cần nghe: ')
  if (!/^[0-9]+$/.test(selection.trim())) return resolveTarget(client, selection)

  const selectedIndex = Number.parseInt(selection, 10) - 1
  const selectedDialog = groupAndChannelDialogs[selectedIndex]
  if (!selectedDialog) throw new Error('Số thứ tự không hợp lệ.')
  return {
    chatTitle: selectedDialog.title,
    chatUsername: selectedDialog.entity?.username || '',
    label: `${selectedDialog.title} (${selectedDialog.id})`,
    watchTarget: selectedDialog.id.toString(),
  }
}

async function main() {
  const configuration = await readConfiguration()
  const apiId = Number.parseInt(requiredEnvironment('TELEGRAM_API_ID'), 10)
  const apiHash = requiredEnvironment('TELEGRAM_API_HASH')
  const phoneNumber = requiredEnvironment('TELEGRAM_PHONE')
  if (!Number.isInteger(apiId) || apiId <= 0) throw new Error('TELEGRAM_API_ID phải là số nguyên dương.')

  const client = new TelegramClient(
    new StringSession(await readSession()),
    apiId,
    apiHash,
    { connectionRetries: 5 },
  )

  console.log('Đang kết nối Telegram...')
  await client.start({
    phoneNumber: async () => phoneNumber,
    password: async () => input.password('Mật khẩu xác minh 2 bước (nếu có): '),
    phoneCode: async () => input.text('Mã đăng nhập Telegram: '),
    onError: (error) => console.error('Lỗi đăng nhập Telegram:', error.message),
  })

  await saveSession(client.session.save())
  const me = await client.getMe()
  console.log(`Đã đăng nhập: ${getSenderName(me)}`)

  const todoRepository = await createTodoRepository(configuration.firestoreCollection)
  const targetGroup = await chooseTargetGroup(client, configuration.targetChat)
  console.log(`Đang nghe tin nhắn mới từ: ${targetGroup.label}`)
  console.log(`Lọc tin có chứa: "${configuration.filterKeyword}"`)
  console.log(`Lưu vào Firestore collection: ${configuration.firestoreCollection}`)
  console.log('Giữ cửa sổ này chạy. Nhấn Ctrl+C để dừng.\n')

  client.updates.catch((error) => {
    console.error(`Lỗi nhận cập nhật: ${error.message}`)
  })

  client.updates.watch(targetGroup.watchTarget, async (update) => {
    const message = update.message
    const text = message.message?.trim() || ''
    if (!normalizeForSearch(text).includes(normalizeForSearch(configuration.filterKeyword))) return

    try {
      const sender = await message.getSender()
      const senderName = getSenderName(sender)
      const chatId = String(message.chatId || targetGroup.watchTarget)
      const sourceLink = targetGroup.chatUsername
        ? `https://t.me/${targetGroup.chatUsername}/${message.id}`
        : ''
      const result = await todoRepository.createFromTelegram({
        telegramMessageId: message.id,
        chatId,
        chatTitle: targetGroup.chatTitle,
        chatUsername: targetGroup.chatUsername,
        senderId: sender?.id?.toString() || '',
        senderName,
        text,
        sourceLink,
        matchedKeyword: configuration.filterKeyword,
        messageDate: toMessageDate(message.date),
      })

      console.log(`[${formatMessageDate(message.date)}] ${senderName}`)
      console.log(`${text}\n`)
      console.log(result.created
        ? `Đã tạo todo Firestore: ${result.id}\n`
        : `Todo đã tồn tại: ${result.id}\n`)
    } catch (error) {
      console.error(`Không thể lưu todo: ${error.message}`)
    }
  })

  const shutdown = async () => {
    console.log('\nĐang ngắt kết nối Telegram...')
    await client.disconnect()
    process.exit(0)
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  await new Promise(() => {})
}

main().catch((error) => {
  console.error(`Không thể khởi động listener: ${error.message}`)
  process.exitCode = 1
})
