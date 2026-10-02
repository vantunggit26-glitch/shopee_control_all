import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'

const defaultCredentialsPath = fileURLToPath(new URL('../.telegram/firebase-service-account.json', import.meta.url))
const expectedProjectId = 'account-vault-tung'

function limitedText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function getCredentialsPath() {
  const configuredPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim()
  return configuredPath ? resolve(process.cwd(), configuredPath) : defaultCredentialsPath
}

async function loadServiceAccount() {
  const credentialsPath = getCredentialsPath()
  let serviceAccount

  try {
    serviceAccount = JSON.parse(await readFile(credentialsPath, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Chưa có Firebase service account tại ${credentialsPath}`, { cause: error })
    }
    throw new Error(`Không thể đọc Firebase service account: ${error.message}`, { cause: error })
  }

  if (!serviceAccount.client_email || !serviceAccount.private_key || !serviceAccount.project_id) {
    throw new Error('File Firebase service account không hợp lệ.')
  }
  if (serviceAccount.project_id !== expectedProjectId) {
    throw new Error(`Service account phải thuộc project ${expectedProjectId}.`)
  }

  return serviceAccount
}

function createDocumentId(chatId, messageId) {
  const safeChatId = String(chatId).replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${safeChatId}_${messageId}`
}

export async function createTodoRepository(collectionName) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(collectionName)) {
    throw new Error('Tên collection Firestore không hợp lệ.')
  }

  const serviceAccount = await loadServiceAccount()
  const firebaseApp = getApps()[0] || initializeApp({ credential: cert(serviceAccount) })
  const firestore = getFirestore(firebaseApp)
  const todoCollection = firestore.collection(collectionName)

  return {
    async createFromTelegram(message) {
      const telegramMessageId = Number(message.telegramMessageId)
      const text = limitedText(message.text, 10000)
      const chatId = limitedText(message.chatId, 100)

      if (!Number.isInteger(telegramMessageId) || telegramMessageId <= 0) {
        throw new Error('Telegram message ID không hợp lệ.')
      }
      if (!chatId || !text) throw new Error('Tin nhắn thiếu chatId hoặc nội dung.')

      const documentReference = todoCollection.doc(createDocumentId(chatId, telegramMessageId))
      try {
        await documentReference.create({
          status: 'pending',
          completed: false,
          source: 'telegram',
          matchedKeyword: limitedText(message.matchedKeyword, 100),
          text,
          telegramMessageId,
          chatId,
          chatTitle: limitedText(message.chatTitle, 300),
          chatUsername: limitedText(message.chatUsername, 100),
          senderId: limitedText(message.senderId, 100),
          senderName: limitedText(message.senderName, 300),
          sourceLink: limitedText(message.sourceLink, 2048),
          messageDate: Timestamp.fromDate(message.messageDate),
          createdAt: FieldValue.serverTimestamp(),
        })
        return { created: true, id: documentReference.id }
      } catch (error) {
        if (error.code === 6 || error.code === 'already-exists') {
          return { created: false, id: documentReference.id }
        }
        throw error
      }
    },
  }
}
