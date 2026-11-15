import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { gzip, gunzip } from 'node:zlib'

const compress = promisify(gzip)
const decompress = promisify(gunzip)
const projectId = 'account-vault-tung'
const databaseName = `projects/${projectId}/databases/(default)`
const documentRoot = `${databaseName}/documents`
const workspace = fileURLToPath(new URL('../', import.meta.url))
const backupDirectory = join(workspace, 'backups')
const format = 'account-vault-firestore-backup/v1'

function checksum(data) {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex')
}

function documentPath(name) {
  if (!name.startsWith(`${documentRoot}/`)) throw new Error('Document không thuộc project đã cấu hình.')
  const path = name.slice(documentRoot.length + 1)
  const segments = path.split('/')
  if (segments.length % 2 !== 0 || segments.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Đường dẫn document không hợp lệ.')
  }
  return path
}

function apiPath(name) {
  return name.split('/').map(encodeURIComponent).join('/')
}

export function validateBackup(envelope) {
  if (envelope?.format !== format || envelope.data?.projectId !== projectId
    || envelope.data?.database !== databaseName || !Array.isArray(envelope.data?.documents)) {
    throw new Error('Sai định dạng backup hoặc sai project/database.')
  }
  if (checksum(envelope.data) !== envelope.sha256) throw new Error('Checksum không đúng: file backup đã thay đổi hoặc bị hỏng.')
  const names = new Set()
  for (const document of envelope.data.documents) {
    documentPath(document.name)
    if (!document.fields || Array.isArray(document.fields) || typeof document.fields !== 'object'
      || names.has(document.name)) throw new Error('Backup chứa document sai định dạng hoặc trùng lặp.')
    names.add(document.name)
  }
  if (envelope.data.documentCount !== names.size) throw new Error('Số document trong backup không khớp.')
  return envelope.data
}

async function loadBackup(file) {
  if (!file) throw new Error('Cần chỉ định --file backups/<ten-file>.json.gz')
  const envelope = JSON.parse((await decompress(await readFile(resolve(file)))).toString('utf8'))
  return validateBackup(envelope)
}

async function createApiClient() {
  // Reuse the local CLI session; credentials/tokens never enter the backup.
  const require = createRequire(import.meta.url)
  const candidates = [
    join(workspace, 'node_modules/firebase-tools/lib/auth.js'),
    ...(process.env.APPDATA ? [join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib/auth.js')] : []),
    ...(process.env.FIREBASE_TOOLS_AUTH_MODULE ? [resolve(process.env.FIREBASE_TOOLS_AUTH_MODULE)] : []),
  ]
  const authModule = candidates.find((candidate) => existsSync(candidate))
  if (!authModule) throw new Error('Không tìm thấy Firebase CLI. Cài npm install -g firebase-tools, rồi firebase login.')
  const auth = require(authModule)
  const account = auth.getGlobalDefaultAccount()
  if (!account) throw new Error('Chưa đăng nhập Firebase CLI. Chạy firebase login trước.')

  return async function request(resource, { method = 'GET', body, allowMissing = false } = {}) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const tokens = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform'])
      const response = await fetch(`https://firestore.googleapis.com/v1/${resource}`, {
        method,
        headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(45000),
      })
      if (response.status === 404 && allowMissing) return null
      if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
        await new Promise((done) => setTimeout(done, 500 * (2 ** attempt)))
        continue
      }
      if (!response.ok) {
        // Do not print response bodies: they may include private document data.
        throw new Error(`Firestore HTTP ${response.status}. Kiểm tra quyền CLI/kết nối rồi chạy lại.`)
      }
      return { data: await response.json(), serverDate: response.headers.get('date') }
    }
    throw new Error('Firestore không phản hồi sau các lần thử lại.')
  }
}

async function exportDatabase() {
  const api = await createApiClient()
  const database = await api(apiPath(databaseName))
  if (database.data.databaseEdition !== 'STANDARD') throw new Error('Script này dành cho Firestore Standard hiện tại.')
  if (!database.serverDate) throw new Error('Không xác định được thời điểm snapshot từ máy chủ.')
  const readTime = new Date(database.serverDate).toISOString()
  const documents = []
  const collections = new Map()
  const queue = [documentRoot]
  let scanned = 0
  console.log(`Đọc snapshot ${readTime} của ${projectId}; chỉ đọc, không ghi database.`)

  async function scanParent(parent) {
    let collectionPage
    do {
      const result = await api(`${apiPath(parent)}:listCollectionIds`, {
        method: 'POST', body: { pageSize: 1000, readTime, ...(collectionPage ? { pageToken: collectionPage } : {}) },
      })
      for (const collectionId of result.data.collectionIds || []) {
        const collectionName = `${parent}/${collectionId}`
        collections.set(collectionName, 0)
        let documentPage
        do {
          const params = new URLSearchParams({ pageSize: '300', showMissing: 'true', readTime })
          if (documentPage) params.set('pageToken', documentPage)
          const page = await api(`${apiPath(collectionName)}?${params}`)
          for (const document of page.data.documents || []) {
            documentPath(document.name)
            // Include missing parents in traversal, but do not create them on restore.
            queue.push(document.name)
            if (document.createTime || document.updateTime) {
              documents.push({ ...document, fields: document.fields || {} })
              collections.set(collectionName, collections.get(collectionName) + 1)
            }
          }
          documentPage = page.data.nextPageToken
        } while (documentPage)
      }
      collectionPage = result.data.nextPageToken
    } while (collectionPage)
    scanned += 1
  }

  while (queue.length) {
    await Promise.all(queue.splice(0, 6).map(scanParent))
    if (scanned % 60 < 6) console.log(`Đã đọc ${documents.length} document, còn ${queue.length} nhánh cần kiểm tra.`)
  }
  documents.sort((left, right) => left.name.localeCompare(right.name))
  const data = {
    projectId, database: databaseName, readTime, completedAt: new Date().toISOString(),
    documentCount: documents.length,
    collectionCounts: Object.fromEntries([...collections].map(([name, count]) => [name.slice(documentRoot.length + 1), count])),
    documents,
  }
  const envelope = { format, sha256: checksum(data), data }
  const fileName = `firestore-${projectId}-${readTime.replace(/[:.]/g, '-')}.json.gz`
  const file = join(backupDirectory, fileName)
  await mkdir(backupDirectory, { recursive: true })
  await writeFile(file, await compress(JSON.stringify(envelope)), { flag: 'wx', mode: 0o600 })
  await loadBackup(file)
  console.log(`Đã lưu và xác minh ${documents.length} document tại ${file}`)
  console.log('Backup gồm mọi collection con và ảnh Base64. Không bao gồm Firebase Authentication hoặc file Cloud Storage.')
  return file
}

async function restoreDatabase(file, apply, confirmation, overwrite) {
  const data = await loadBackup(file)
  console.log(`Backup hợp lệ: ${data.documentCount} document; snapshot ${data.readTime}.`)
  if (!apply) {
    console.log('DRY RUN: chưa ghi gì. Mặc định chỉ khôi phục document chưa tồn tại, không xóa document khác.')
    console.log('Muốn thực thi: thêm --apply --confirm-project account-vault-tung. --overwrite cho phép thay thế document đã có.')
    return
  }
  if (confirmation !== projectId) throw new Error('Cần --confirm-project account-vault-tung để ghi dữ liệu.')
  const api = await createApiClient()
  let restored = 0
  let skipped = 0
  for (const document of data.documents) {
    const current = await api(apiPath(document.name), { allowMissing: true })
    if (current && !overwrite) {
      skipped += 1
      continue
    }
    // Precondition prevents overwriting a concurrent change during restore.
    await api(`${apiPath(databaseName)}/documents:commit`, {
      method: 'POST',
      body: { writes: [{
        update: { name: document.name, fields: document.fields },
        currentDocument: current ? { updateTime: current.data.updateTime } : { exists: false },
      }] },
    })
    restored += 1
  }
  console.log(`Đã khôi phục ${restored}; bỏ qua ${skipped} document đã có. Không xóa dữ liệu khác.`)
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  const option = (name) => args[args.indexOf(name) + 1]
  const file = args.includes('--file') ? option('--file') : undefined
  if (command === 'export') return exportDatabase()
  if (command === 'verify') {
    const data = await loadBackup(file)
    console.log(`Checksum hợp lệ: ${data.documentCount} document; snapshot ${data.readTime}.`)
    return
  }
  if (command === 'restore') {
    return restoreDatabase(file, args.includes('--apply'), args.includes('--confirm-project') ? option('--confirm-project') : '', args.includes('--overwrite'))
  }
  throw new Error('Dùng export, verify --file <file>, hoặc restore --file <file> [--apply --confirm-project account-vault-tung].')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
