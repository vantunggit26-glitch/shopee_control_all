import { readFile } from 'node:fs/promises'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const configurationFile = new URL('../telegram-listener.config.json', import.meta.url)
const credentialsFile = new URL('../.telegram/firebase-service-account.json', import.meta.url)
const expectedProjectId = 'account-vault-tung'
const batchSize = 400
const shouldApply = process.argv.includes('--apply')

function normalizeForSearch(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('vi')
    .replace(/\s+/gu, ' ')
    .trim()
}

function matchesAllowedKeyword(text, keywords) {
  const normalizedText = normalizeForSearch(text)
  return keywords.some((keyword) => normalizedText.includes(normalizeForSearch(keyword)))
}

async function loadConfiguration() {
  const configuration = JSON.parse(await readFile(configurationFile, 'utf8'))
  const keywords = (Array.isArray(configuration.filterKeywords) ? configuration.filterKeywords : [])
    .map((keyword) => String(keyword || '').trim())
    .filter(Boolean)
  const collections = [...new Set(
    (Array.isArray(configuration.sources) ? configuration.sources : [])
      .map((source) => String(source.firestoreCollection || '').trim())
      .filter((collection) => /^[a-zA-Z0-9_-]{1,100}$/.test(collection)),
  )]

  if (keywords.length === 0 || collections.length === 0) {
    throw new Error('Cấu hình thiếu filterKeywords hoặc firestoreCollection hợp lệ.')
  }
  return { keywords, collections }
}

async function createFirestore() {
  const serviceAccount = JSON.parse(await readFile(credentialsFile, 'utf8'))
  if (serviceAccount.project_id !== expectedProjectId) {
    throw new Error(`Service account không thuộc project ${expectedProjectId}.`)
  }
  const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount) })
  return getFirestore(app)
}

async function inspectCollection(firestore, collectionName, keywords) {
  const snapshot = await firestore
    .collection(collectionName)
    .where('source', '==', 'telegram')
    .get()
  const invalidDocuments = snapshot.docs.filter((documentSnapshot) => (
    !matchesAllowedKeyword(documentSnapshot.get('text'), keywords)
  ))

  return {
    collectionName,
    totalTelegram: snapshot.size,
    validCount: snapshot.size - invalidDocuments.length,
    invalidDocuments,
  }
}

async function deleteDocuments(firestore, documents) {
  let deletedCount = 0
  for (let offset = 0; offset < documents.length; offset += batchSize) {
    const batch = firestore.batch()
    const currentDocuments = documents.slice(offset, offset + batchSize)
    currentDocuments.forEach((documentSnapshot) => batch.delete(documentSnapshot.ref))
    await batch.commit()
    deletedCount += currentDocuments.length
  }
  return deletedCount
}

async function main() {
  const { keywords, collections } = await loadConfiguration()
  const firestore = await createFirestore()
  let totalInvalid = 0
  let totalDeleted = 0

  console.log(`Chế độ: ${shouldApply ? 'XÓA' : 'KIỂM TRA'}`)
  console.log(`Project: ${expectedProjectId}`)
  console.log(`Từ khóa được giữ lại: ${keywords.join(' | ')}`)

  for (const collectionName of collections) {
    const result = await inspectCollection(firestore, collectionName, keywords)
    totalInvalid += result.invalidDocuments.length
    console.log(
      `${collectionName}: tổng Telegram=${result.totalTelegram}, hợp lệ=${result.validCount}, không hợp lệ=${result.invalidDocuments.length}`,
    )
    if (shouldApply && result.invalidDocuments.length > 0) {
      totalDeleted += await deleteDocuments(firestore, result.invalidDocuments)
    }
  }

  console.log(`Tổng không hợp lệ: ${totalInvalid}`)
  if (shouldApply) console.log(`Đã xóa: ${totalDeleted}`)
}

main().catch((error) => {
  console.error(`Dọn dữ liệu thất bại: ${error.message}`)
  process.exitCode = 1
})
