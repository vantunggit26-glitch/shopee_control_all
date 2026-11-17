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
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('vi')
    .replace(/\s+/gu, ' ')
    .trim()
}

function findMatchedKeyword(text, keywords) {
  const normalizedText = normalizeForSearch(text)
  return keywords.find((keyword) => normalizedText.includes(normalizeForSearch(keyword))) || ''
}

async function readConfiguration() {
  const configuration = JSON.parse(await readFile(configurationFile, 'utf8'))
  const environmentKeywords = process.env.TELEGRAM_FILTER_KEYWORDS
    ?.split('|')
    .map((keyword) => keyword.trim())
    .filter(Boolean)
  const legacyEnvironmentKeyword = process.env.TELEGRAM_FILTER_KEYWORD?.trim()
  const filterKeywords = environmentKeywords?.length
    ? environmentKeywords
    : legacyEnvironmentKeyword
      ? [legacyEnvironmentKeyword]
      : (Array.isArray(configuration.filterKeywords)
          ? configuration.filterKeywords
          : [configuration.filterKeyword])
        .map((keyword) => String(keyword || '').trim())
        .filter(Boolean)
  if (filterKeywords.length === 0) {
    throw new Error('Thiếu filterKeywords trong telegram-listener.config.json.')
  }
  const configuredSources = Array.isArray(configuration.sources)
    ? configuration.sources
    : [{
      key: 'voucher-public',
      targetChat: process.env.TELEGRAM_TARGET_CHAT?.trim() || configuration.targetChat,
      firestoreCollection: configuration.firestoreCollection,
      visibility: 'public',
    }]
  const sources = configuredSources.map((source) => ({
    key: String(source.key || '').trim(),
    targetChat: String(source.targetChat || '').trim(),
    firestoreCollection: String(source.firestoreCollection || '').trim(),
    visibility: source.visibility === 'authenticated' ? 'authenticated' : 'public',
  }))

  if (sources.length === 0 || sources.some((source) => (
    !source.key || !source.targetChat || !source.firestoreCollection
  ))) {
    throw new Error('Cấu hình sources trong telegram-listener.config.json không hợp lệ.')
  }

  return { filterKeywords: [...new Set(filterKeywords)], sources }
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

  const activeSources = []
  for (const source of configuration.sources) {
    const todoRepository = await createTodoRepository(source.firestoreCollection)
    const targetGroup = await chooseTargetGroup(client, source.targetChat)
    activeSources.push({ ...source, todoRepository, targetGroup })
  }

  console.log(`Đang nghe ${activeSources.length} kênh Telegram:`)
  activeSources.forEach((source) => {
    console.log(`- ${source.targetGroup.label} -> ${source.firestoreCollection} (${source.visibility})`)
  })
  console.log(`Chỉ lưu tin có chứa một trong ${configuration.filterKeywords.length} từ khóa:`)
  configuration.filterKeywords.forEach((keyword) => console.log(`- ${keyword}`))
  console.log('Giữ cửa sổ này chạy. Nhấn Ctrl+C để dừng.\n')

  client.updates.catch((error) => {
    console.error(`Lỗi nhận cập nhật: ${error.message}`)
  })

  activeSources.forEach((source) => {
    client.updates.watch(source.targetGroup.watchTarget, async (update) => {
      const message = update.message
      const text = message.message?.trim() || ''
      if (!text) return
      const matchedKeyword = findMatchedKeyword(text, configuration.filterKeywords)
      if (!matchedKeyword) return
      const containsNewUserKeyword = normalizeForSearch(matchedKeyword)
        === normalizeForSearch(configuration.filterKeywords[0])

      try {
        const sender = await message.getSender()
        const senderName = getSenderName(sender)
        const chatId = String(message.chatId || source.targetGroup.watchTarget)
        const sourceLink = source.targetGroup.chatUsername
          ? `https://t.me/${source.targetGroup.chatUsername}/${message.id}`
          : ''
        const result = await source.todoRepository.createFromTelegram({
          telegramMessageId: message.id,
          chatId,
          chatTitle: source.targetGroup.chatTitle,
          chatUsername: source.targetGroup.chatUsername,
          channelKey: source.key,
          visibility: source.visibility,
          senderId: sender?.id?.toString() || '',
          senderName,
          text,
          sourceLink,
          matchedKeyword,
          containsNewUserKeyword,
          messageDate: toMessageDate(message.date),
        })

        console.log(`[${formatMessageDate(message.date)}] ${source.targetGroup.chatTitle} · ${senderName}`)
        console.log(`${text}\n`)
        console.log(result.created
          ? `Đã tạo ${source.firestoreCollection}: ${result.id}\n`
          : `Tin đã tồn tại: ${result.id}\n`)
      } catch (error) {
        console.error(`Không thể lưu tin từ ${source.targetGroup.label}: ${error.message}`)
      }
    })
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
