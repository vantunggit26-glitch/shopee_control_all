import { initializeApp } from 'firebase-admin/app'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { TelegramClient } from 'teleproto'
import { StringSession } from 'teleproto/sessions/index.js'

initializeApp()

const targetChat = '@magiamgiavoucher'
const filterKeyword = 'Người mới'
const todoCollectionName = 'todo'
const stateCollectionName = '_syncState'
const stateDocumentName = 'telegram_magiamgiavoucher'
const firstRunLookbackMilliseconds = 2 * 60 * 60 * 1000
const messageBatchLimit = 1000
const retentionDays = 5
const retentionMilliseconds = retentionDays * 24 * 60 * 60 * 1000
const firestoreBatchLimit = 400
const logger = {
  info(message, details = {}) {
    console.log(JSON.stringify({ severity: 'INFO', message, ...details }))
  },
  warn(message, details = {}) {
    console.warn(JSON.stringify({ severity: 'WARNING', message, ...details }))
  },
}

async function withTimeout(promise, timeoutMilliseconds, operationName) {
  let timeout
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${operationName} vượt quá ${timeoutMilliseconds / 1000} giây.`))
    }, timeoutMilliseconds)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeForSearch(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('vi')
}

function limitedText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function toMessageDate(value) {
  if (value instanceof Date) return value

  const numericValue = Number(value)
  const date = new Date(numericValue < 10_000_000_000 ? numericValue * 1000 : numericValue)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function createDocumentId(chatId, messageId) {
  const safeChatId = String(chatId).replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${safeChatId}_${messageId}`
}

function getSenderName(sender) {
  if (!sender) return 'Không rõ người gửi'
  if (sender.username) return `@${sender.username}`

  const fullName = [sender.firstName, sender.lastName].filter(Boolean).join(' ').trim()
  return fullName || sender.title || String(sender.id || 'Không rõ người gửi')
}

async function getSender(message) {
  try {
    return await message.getSender()
  } catch (error) {
    logger.warn('Không thể lấy thông tin người gửi.', { error: error.message })
    return null
  }
}

async function saveMatchingMessage(firestore, message, targetEntity) {
  const text = limitedText(message.message, 10000)
  const chatId = limitedText(message.chatId || targetEntity.id, 100)
  const telegramMessageId = Number(message.id)
  const messageDate = toMessageDate(message.date)
  const sender = await getSender(message)
  const chatTitle = limitedText(targetEntity.title || targetChat, 300)
  const chatUsername = limitedText(targetEntity.username || targetChat.replace(/^@/, ''), 100)
  const sourceLink = chatUsername
    ? `https://t.me/${chatUsername}/${telegramMessageId}`
    : ''
  const documentReference = firestore
    .collection(todoCollectionName)
    .doc(createDocumentId(chatId, telegramMessageId))

  try {
    await documentReference.create({
      status: 'pending',
      completed: false,
      source: 'telegram',
      matchedKeyword: filterKeyword,
      text,
      telegramMessageId,
      chatId,
      chatTitle,
      chatUsername,
      senderId: limitedText(sender?.id, 100),
      senderName: limitedText(getSenderName(sender), 300),
      sourceLink: limitedText(sourceLink, 2048),
      messageDate: Timestamp.fromDate(messageDate),
      expiresAt: Timestamp.fromMillis(messageDate.getTime() + retentionMilliseconds),
      createdAt: FieldValue.serverTimestamp(),
    })
    return true
  } catch (error) {
    if (error.code === 6 || error.code === 'already-exists') return false
    throw error
  }
}

function getStoredMessageDate(documentSnapshot) {
  const value = documentSnapshot.get('messageDate')
  if (value && typeof value.toDate === 'function') return value.toDate()

  const fallbackDate = toMessageDate(value)
  return Number.isNaN(fallbackDate.getTime()) ? new Date() : fallbackDate
}

async function migrateTelegramRetention(firestore, stateSnapshot) {
  if (stateSnapshot.get('retentionMigratedAt')) {
    return { deletedCount: 0, migratedCount: 0, completed: false }
  }

  const snapshot = await firestore
    .collection(todoCollectionName)
    .where('source', '==', 'telegram')
    .get()
  const now = Date.now()
  let deletedCount = 0
  let migratedCount = 0

  for (let offset = 0; offset < snapshot.docs.length; offset += firestoreBatchLimit) {
    const batch = firestore.batch()
    const documents = snapshot.docs.slice(offset, offset + firestoreBatchLimit)
    let operationCount = 0

    for (const documentSnapshot of documents) {
      if (documentSnapshot.get('expiresAt')) continue

      const expiresAtMilliseconds = getStoredMessageDate(documentSnapshot).getTime()
        + retentionMilliseconds
      if (expiresAtMilliseconds <= now) {
        batch.delete(documentSnapshot.ref)
        deletedCount += 1
        operationCount += 1
      } else {
        batch.update(documentSnapshot.ref, {
          expiresAt: Timestamp.fromMillis(expiresAtMilliseconds),
        })
        migratedCount += 1
        operationCount += 1
      }
    }

    if (operationCount > 0) await batch.commit()
  }

  return { deletedCount, migratedCount, completed: true }
}

async function deleteExpiredTelegramMessages(firestore) {
  const todoCollection = firestore.collection(todoCollectionName)
  let deletedCount = 0

  while (true) {
    const snapshot = await todoCollection
      .where('expiresAt', '<=', Timestamp.now())
      .limit(firestoreBatchLimit)
      .get()
    if (snapshot.empty) break

    const batch = firestore.batch()
    snapshot.docs.forEach((documentSnapshot) => batch.delete(documentSnapshot.ref))
    await batch.commit()
    deletedCount += snapshot.size

    if (snapshot.size < firestoreBatchLimit) break
  }

  return deletedCount
}

export async function synchronizeTelegramMessages() {
  const apiId = Number.parseInt(process.env.TELEGRAM_API_ID, 10)
  const apiHash = process.env.TELEGRAM_API_HASH?.trim() || ''
  const session = process.env.TELEGRAM_SESSION?.trim() || ''

  if (!Number.isInteger(apiId) || apiId <= 0) {
    throw new Error('Secret TELEGRAM_API_ID không hợp lệ.')
  }
  if (!apiHash || !session) {
    throw new Error('Thiếu TELEGRAM_API_HASH hoặc TELEGRAM_SESSION.')
  }

  const client = new TelegramClient(
    new StringSession(session),
    apiId,
    apiHash,
    { connectionRetries: 5 },
  )

  try {
    logger.info('Đang kết nối Telegram.', { targetChat })
    await withTimeout(client.connect(), 60_000, 'Kết nối Telegram')
    if (!(await withTimeout(client.checkAuthorization(), 30_000, 'Kiểm tra Telegram session'))) {
      throw new Error('Telegram session đã hết hạn hoặc chưa được đăng nhập.')
    }

    const firestore = getFirestore()
    const stateReference = firestore.collection(stateCollectionName).doc(stateDocumentName)
    const stateSnapshot = await stateReference.get()
    const lastMessageId = stateSnapshot.exists
      ? Number(stateSnapshot.get('lastMessageId')) || 0
      : 0
    const retentionMigration = await migrateTelegramRetention(firestore, stateSnapshot)
    const expiredDeletedCount = await deleteExpiredTelegramMessages(firestore)
    const targetEntity = await withTimeout(
      client.getEntity(targetChat),
      30_000,
      'Tìm kênh Telegram',
    )
    logger.info('Đang tải tin nhắn Telegram.', { targetChat, lastMessageId })
    const messages = await withTimeout(
      client.getMessages(targetEntity, lastMessageId > 0
        ? { limit: messageBatchLimit, minId: lastMessageId, reverse: true }
        : { limit: messageBatchLimit }),
      180_000,
      'Tải tin nhắn Telegram',
    )
    const orderedMessages = [...messages]
      .filter((message) => Number.isInteger(Number(message.id)))
      .sort((left, right) => Number(left.id) - Number(right.id))
    const firstRunCutoff = Date.now() - firstRunLookbackMilliseconds
    let newestMessageId = lastMessageId
    let matchedCount = 0
    let createdCount = 0

    for (const message of orderedMessages) {
      const messageId = Number(message.id)
      newestMessageId = Math.max(newestMessageId, messageId)

      if (lastMessageId === 0 && toMessageDate(message.date).getTime() < firstRunCutoff) continue

      const text = limitedText(message.message, 10000)
      if (!text || !normalizeForSearch(text).includes(normalizeForSearch(filterKeyword))) continue

      matchedCount += 1
      if (await saveMatchingMessage(firestore, message, targetEntity)) createdCount += 1
    }

    const stateUpdate = {
      targetChat,
      filterKeyword,
      retentionDays,
      lastMessageId: newestMessageId,
      fetchedCount: orderedMessages.length,
      matchedCount,
      createdCount,
      deletedCount: retentionMigration.deletedCount + expiredDeletedCount,
      migratedCount: retentionMigration.migratedCount,
      updatedAt: FieldValue.serverTimestamp(),
    }
    if (retentionMigration.completed) {
      stateUpdate.retentionMigratedAt = FieldValue.serverTimestamp()
    }
    await stateReference.set(stateUpdate, { merge: true })

    logger.info('Đồng bộ Telegram hoàn tất.', {
      targetChat,
      previousMessageId: lastMessageId,
      newestMessageId,
      fetchedCount: orderedMessages.length,
      matchedCount,
      createdCount,
      deletedCount: retentionMigration.deletedCount + expiredDeletedCount,
      migratedCount: retentionMigration.migratedCount,
    })
  } finally {
    await withTimeout(client.disconnect(), 10_000, 'Ngắt kết nối Telegram').catch((error) => {
      logger.warn('Không thể ngắt kết nối Telegram.', { error: error.message })
    })
  }
}
