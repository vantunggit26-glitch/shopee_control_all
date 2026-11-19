import { initializeApp } from 'firebase-admin/app'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { TelegramClient } from 'teleproto'
import { StringSession } from 'teleproto/sessions/index.js'

initializeApp()

const filterKeywords = [
  'Người mới',
  'cho đơn đầu tiên',
  'Mã giảm 100K',
  '80K đơn từ 0Đ',
  '100K đơn từ 0Đ',
  '80K/0Đ',
  '100K/0Đ',
  '75K/0Đ',
  '85K/0Đ',
  '90K/0Đ',
  '95K/0Đ',
  '120K/0Đ',
  '110K/0Đ',
]
const stateCollectionName = '_syncState'
const automationStatusDocumentName = 'telegram_automation'
const automationLogLimit = 20
const syncScheduleMinutes = Number.parseInt(
  process.env.TELEGRAM_SYNC_SCHEDULE_MINUTES || '20',
  10,
)
const syncScheduleOffsetMinute = Number.parseInt(
  process.env.TELEGRAM_SYNC_SCHEDULE_OFFSET_MINUTE || '7',
  10,
)
const telegramSources = [
  {
    key: 'voucher-public',
    targetChat: '@magiamgiavoucher',
    firestoreCollection: 'todo',
    stateDocument: 'telegram_magiamgiavoucher',
    visibility: 'public',
  },
  {
    key: 'sale-zero-authenticated',
    targetChat: '@magiamgia_deal0d_shopee',
    firestoreCollection: 'todoAuthenticated',
    stateDocument: 'telegram_magiamgia_deal0d_shopee',
    visibility: 'authenticated',
  },
]
const messageBatchLimit = 1000
const backfillMessageLimit = 3000
const retentionDays = 5
const retentionMilliseconds = retentionDays * 24 * 60 * 60 * 1000
const firestoreBatchLimit = 400
const linkResolutionVersion = 1
const filterKeywordsVersion = 2
const linkResolutionCache = new Map()
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

function createRunContext() {
  const startedAt = new Date()
  const runId = limitedText(
    process.env.GITHUB_RUN_ID || `local-${startedAt.getTime()}`,
    100,
  )
  const repository = limitedText(process.env.GITHUB_REPOSITORY, 200)
  const serverUrl = limitedText(process.env.GITHUB_SERVER_URL, 500)

  return {
    runId,
    runAttempt: Number.parseInt(process.env.GITHUB_RUN_ATTEMPT || '1', 10) || 1,
    eventName: limitedText(process.env.GITHUB_EVENT_NAME || 'manual', 100),
    commitSha: limitedText(process.env.GITHUB_SHA, 100),
    startedAt,
    runUrl: serverUrl && repository && process.env.GITHUB_RUN_ID
      ? `${serverUrl}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : '',
  }
}

function sanitizeSyncError(error) {
  let message = limitedText(error?.message || error || 'Lỗi không xác định.', 1200)
  for (const secret of [
    process.env.TELEGRAM_API_HASH,
    process.env.TELEGRAM_SESSION,
  ]) {
    if (secret?.trim()) message = message.replaceAll(secret.trim(), '[đã ẩn]')
  }
  return message
}

function summarizeSyncResults(results = []) {
  return results.reduce((summary, result) => ({
    sourceCount: summary.sourceCount + 1,
    fetchedCount: summary.fetchedCount + (Number(result.fetchedCount) || 0),
    matchedCount: summary.matchedCount + (Number(result.matchedCount) || 0),
    createdCount: summary.createdCount + (Number(result.createdCount) || 0),
    deletedCount: summary.deletedCount + (Number(result.deletedCount) || 0),
  }), {
    sourceCount: 0,
    fetchedCount: 0,
    matchedCount: 0,
    createdCount: 0,
    deletedCount: 0,
  })
}

async function markAutomationStarted(firestore, run) {
  const statusReference = firestore
    .collection(stateCollectionName)
    .doc(automationStatusDocumentName)

  await statusReference.set({
    status: 'running',
    workflowName: 'Telegram sync every 20 minutes',
    scheduleMinutes: syncScheduleMinutes,
    scheduleOffsetMinute: syncScheduleOffsetMinute,
    currentRun: {
      id: run.runId,
      attempt: run.runAttempt,
      eventName: run.eventName,
      commitSha: run.commitSha,
      runUrl: run.runUrl,
      startedAt: run.startedAt.toISOString(),
    },
    lastAttemptAt: Timestamp.fromDate(run.startedAt),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
}

async function markAutomationCompleted(firestore, run, status, results, error = null) {
  const statusReference = firestore
    .collection(stateCollectionName)
    .doc(automationStatusDocumentName)
  const completedAt = new Date()
  const durationMs = Math.max(0, completedAt.getTime() - run.startedAt.getTime())
  const summary = summarizeSyncResults(results)
  const errorMessage = status === 'failure' ? sanitizeSyncError(error) : ''
  const message = status === 'success'
    ? `Đã kiểm tra ${summary.sourceCount} kênh, thêm ${summary.createdCount} tin mới và xóa ${summary.deletedCount} tin hết hạn.`
    : `Đồng bộ thất bại: ${errorMessage}`
  const snapshot = await statusReference.get()
  const previousLogs = snapshot.exists && Array.isArray(snapshot.get('logs'))
    ? snapshot.get('logs')
    : []
  const logEntry = {
    runId: run.runId,
    attempt: run.runAttempt,
    eventName: run.eventName,
    commitSha: run.commitSha,
    runUrl: run.runUrl,
    status,
    startedAt: run.startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs,
    message,
    error: errorMessage,
    ...summary,
  }
  const update = {
    status,
    currentRun: null,
    lastCompletedAt: Timestamp.fromDate(completedAt),
    nextExpectedAt: Timestamp.fromMillis(
      run.startedAt.getTime() + syncScheduleMinutes * 60 * 1000,
    ),
    durationMs,
    lastError: errorMessage,
    latestSummary: summary,
    logs: [logEntry, ...previousLogs].slice(0, automationLogLimit),
    updatedAt: FieldValue.serverTimestamp(),
  }

  if (status === 'success') update.lastSuccessAt = Timestamp.fromDate(completedAt)
  if (status === 'failure') update.lastFailureAt = Timestamp.fromDate(completedAt)

  await statusReference.set(update, { merge: true })
}

async function safelyUpdateAutomationStatus(operationName, operation) {
  try {
    await operation()
  } catch (error) {
    logger.warn(`Không thể ${operationName} trạng thái đồng bộ.`, {
      error: sanitizeSyncError(error),
    })
  }
}

function normalizeForSearch(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('vi')
    .replace(/\s+/gu, ' ')
    .trim()
}

function findMatchedKeyword(text) {
  const normalizedText = normalizeForSearch(text)
  return filterKeywords.find((keyword) => normalizedText.includes(normalizeForSearch(keyword))) || ''
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

function getMessageDay(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function extractLinks(text) {
  const matches = String(text).match(/https?:\/\/[^\s<>"']+/giu) || []
  return [...new Set(matches.map((link) => link.replace(/[),.;!?]+$/gu, '')))].slice(0, 20)
}

function extractCodes(text) {
  const textWithoutLinks = String(text).replace(/https?:\/\/[^\s<>"']+/giu, ' ')
  const matches = textWithoutLinks.match(/\b(?=[A-Z0-9]{5,24}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*[0-9])[A-Z0-9]+\b/g) || []
  return [...new Set(matches)].slice(0, 20)
}

function isShopeeShortLink(value) {
  try {
    const hostname = new URL(value).hostname.toLocaleLowerCase('en')
    return hostname === 's.shopee.vn' || hostname === 'vn.shp.ee' || hostname === 'shp.ee'
  } catch {
    return false
  }
}

async function resolveLink(value) {
  if (!isShopeeShortLink(value)) return value
  if (linkResolutionCache.has(value)) return linkResolutionCache.get(value)

  const resolutionPromise = fetch(value, {
    method: 'HEAD',
    redirect: 'follow',
    signal: AbortSignal.timeout(12_000),
    headers: { 'user-agent': 'Mozilla/5.0' },
  })
    .then((response) => response.url || value)
    .catch((error) => {
      logger.warn('Không thể mở link rút gọn Shopee.', { url: value, error: error.message })
      return value
    })
  linkResolutionCache.set(value, resolutionPromise)
  return resolutionPromise
}

function extractCodesFromLinks(links) {
  const codes = []
  for (const value of links) {
    try {
      const url = new URL(value)
      for (const parameterName of ['keyword', 'voucherCode', 'code']) {
        const candidate = url.searchParams.get(parameterName)?.trim() || ''
        if (/^(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{5,40}$/.test(candidate)) codes.push(candidate)
      }
    } catch {
      continue
    }
  }
  return [...new Set(codes)]
}

async function saveTelegramMessage(firestore, message, targetEntity, source) {
  const text = limitedText(message.message, 10000)
  const chatId = limitedText(message.chatId || targetEntity.id, 100)
  const telegramMessageId = Number(message.id)
  const messageDate = toMessageDate(message.date)
  const chatTitle = limitedText(targetEntity.title || source.targetChat, 300)
  const chatUsername = limitedText(targetEntity.username || source.targetChat.replace(/^@/, ''), 100)
  const matchedKeyword = findMatchedKeyword(text)
  const containsNewUserKeyword = normalizeForSearch(matchedKeyword)
    === normalizeForSearch(filterKeywords[0])
  const links = extractLinks(text)
  const resolvedLinks = await Promise.all(links.map(resolveLink))
  const derivedData = {
    matchedKeyword,
    containsNewUserKeyword,
    detectedCodes: [...new Set([...extractCodes(text), ...extractCodesFromLinks(resolvedLinks)])].slice(0, 20),
    links,
    resolvedLinks,
    channelKey: source.key,
    visibility: source.visibility,
    messageDay: getMessageDay(messageDate),
    expiresAt: Timestamp.fromMillis(messageDate.getTime() + retentionMilliseconds),
  }
  const sourceLink = chatUsername
    ? `https://t.me/${chatUsername}/${telegramMessageId}`
    : ''
  const documentReference = firestore
    .collection(source.firestoreCollection)
    .doc(createDocumentId(chatId, telegramMessageId))

  try {
    await documentReference.create({
      status: 'pending',
      completed: false,
      source: 'telegram',
      text,
      telegramMessageId,
      chatId,
      chatTitle,
      chatUsername,
      senderId: limitedText(targetEntity.id, 100),
      senderName: chatTitle,
      sourceLink: limitedText(sourceLink, 2048),
      messageDate: Timestamp.fromDate(messageDate),
      createdAt: FieldValue.serverTimestamp(),
      ...derivedData,
    })
    return true
  } catch (error) {
    if (error.code === 6 || error.code === 'already-exists') {
      await documentReference.set(derivedData, { merge: true })
      return false
    }
    throw error
  }
}

function getStoredMessageDate(documentSnapshot) {
  const value = documentSnapshot.get('messageDate')
  if (value && typeof value.toDate === 'function') return value.toDate()

  const fallbackDate = toMessageDate(value)
  return Number.isNaN(fallbackDate.getTime()) ? new Date() : fallbackDate
}

async function migrateTelegramRetention(firestore, stateSnapshot, collectionName) {
  if (stateSnapshot.get('retentionMigratedAt')) {
    return { deletedCount: 0, migratedCount: 0, completed: false }
  }

  const snapshot = await firestore
    .collection(collectionName)
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

async function deleteExpiredTelegramMessages(firestore, collectionName) {
  const todoCollection = firestore.collection(collectionName)
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

async function synchronizeTelegramSource(client, firestore, source) {
  const stateReference = firestore.collection(stateCollectionName).doc(source.stateDocument)
  const stateSnapshot = await stateReference.get()
  const lastMessageId = stateSnapshot.exists
    ? Number(stateSnapshot.get('lastMessageId')) || 0
    : 0
  const shouldBackfillAllMessages = !stateSnapshot.get('allMessagesBackfilledAt')
    || Number(stateSnapshot.get('linkResolutionVersion') || 0) < linkResolutionVersion
    || Number(stateSnapshot.get('filterKeywordsVersion') || 0) < filterKeywordsVersion
  const retentionMigration = await migrateTelegramRetention(
    firestore,
    stateSnapshot,
    source.firestoreCollection,
  )
  const expiredDeletedCount = await deleteExpiredTelegramMessages(
    firestore,
    source.firestoreCollection,
  )
  const targetEntity = await withTimeout(
    client.getEntity(source.targetChat),
    30_000,
    `Tìm kênh Telegram ${source.targetChat}`,
  )
  logger.info('Đang tải tin nhắn Telegram.', {
    targetChat: source.targetChat,
    collection: source.firestoreCollection,
    lastMessageId,
  })
  const newMessages = await withTimeout(
    client.getMessages(targetEntity, lastMessageId > 0
      ? { limit: messageBatchLimit, minId: lastMessageId, reverse: true }
      : { limit: messageBatchLimit }),
    180_000,
    `Tải tin nhắn Telegram ${source.targetChat}`,
  )
  const backfillMessages = shouldBackfillAllMessages
    ? await withTimeout(
      client.getMessages(targetEntity, { limit: backfillMessageLimit }),
      240_000,
      `Tải lịch sử Telegram 5 ngày ${source.targetChat}`,
    )
    : []
  const messagesById = new Map(
    [...newMessages, ...backfillMessages].map((message) => [Number(message.id), message]),
  )
  const orderedMessages = [...messagesById.values()]
    .filter((message) => Number.isInteger(Number(message.id)))
    .sort((left, right) => Number(left.id) - Number(right.id))
  const retentionCutoff = Date.now() - retentionMilliseconds
  let newestMessageId = lastMessageId
  let matchedCount = 0
  let createdCount = 0
  const messagesToSave = []

  for (const message of orderedMessages) {
    const messageId = Number(message.id)
    newestMessageId = Math.max(newestMessageId, messageId)
    const text = limitedText(message.message, 10000)
    if (!text || toMessageDate(message.date).getTime() < retentionCutoff) continue

    if (!findMatchedKeyword(text)) continue
    matchedCount += 1
    messagesToSave.push(message)
  }

  for (let offset = 0; offset < messagesToSave.length; offset += 5) {
    const results = await Promise.all(
      messagesToSave
        .slice(offset, offset + 5)
        .map((message) => saveTelegramMessage(firestore, message, targetEntity, source)),
    )
    createdCount += results.filter(Boolean).length
  }

  const stateUpdate = {
    targetChat: source.targetChat,
    channelKey: source.key,
    firestoreCollection: source.firestoreCollection,
    visibility: source.visibility,
    filterKeywords,
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
  if (shouldBackfillAllMessages) {
    stateUpdate.allMessagesBackfilledAt = FieldValue.serverTimestamp()
    stateUpdate.linkResolutionVersion = linkResolutionVersion
    stateUpdate.filterKeywordsVersion = filterKeywordsVersion
    stateUpdate.linksResolvedAt = FieldValue.serverTimestamp()
  }
  await stateReference.set(stateUpdate, { merge: true })

  const result = {
    targetChat: source.targetChat,
    collection: source.firestoreCollection,
    previousMessageId: lastMessageId,
    newestMessageId,
    fetchedCount: orderedMessages.length,
    savedCount: messagesToSave.length,
    matchedCount,
    createdCount,
    deletedCount: retentionMigration.deletedCount + expiredDeletedCount,
    migratedCount: retentionMigration.migratedCount,
  }
  logger.info('Đồng bộ kênh Telegram hoàn tất.', result)
  return result
}

export async function synchronizeTelegramMessages() {
  const firestore = getFirestore()
  const run = createRunContext()
  const apiId = Number.parseInt(process.env.TELEGRAM_API_ID, 10)
  const apiHash = process.env.TELEGRAM_API_HASH?.trim() || ''
  const session = process.env.TELEGRAM_SESSION?.trim() || ''

  await safelyUpdateAutomationStatus(
    'ghi trạng thái bắt đầu',
    () => markAutomationStarted(firestore, run),
  )

  try {
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
    const results = []

    try {
      logger.info('Đang kết nối Telegram.', { sourceCount: telegramSources.length })
      await withTimeout(client.connect(), 60_000, 'Kết nối Telegram')
      if (!(await withTimeout(client.checkAuthorization(), 30_000, 'Kiểm tra Telegram session'))) {
        throw new Error('Telegram session đã hết hạn hoặc chưa được đăng nhập.')
      }

      for (const source of telegramSources) {
        results.push(await synchronizeTelegramSource(client, firestore, source))
      }
      logger.info('Đồng bộ tất cả kênh Telegram hoàn tất.', { results })
    } finally {
      await withTimeout(client.disconnect(), 10_000, 'Ngắt kết nối Telegram').catch((error) => {
        logger.warn('Không thể ngắt kết nối Telegram.', { error: error.message })
      })
    }

    await safelyUpdateAutomationStatus(
      'ghi kết quả thành công',
      () => markAutomationCompleted(firestore, run, 'success', results),
    )
    return results
  } catch (error) {
    await safelyUpdateAutomationStatus(
      'ghi lỗi',
      () => markAutomationCompleted(firestore, run, 'failure', [], error),
    )
    throw error
  }
}
