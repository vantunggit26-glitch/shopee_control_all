import { appendFile } from 'node:fs/promises'
import { describeTelegramFailure, escapeAnnotation } from './telegram-errors.js'

async function main() {
  const requiredEnvironmentVariables = [
    'TELEGRAM_API_ID',
    'TELEGRAM_API_HASH',
    'TELEGRAM_SESSION',
    'GOOGLE_APPLICATION_CREDENTIALS',
  ]
  const missingEnvironmentVariables = requiredEnvironmentVariables.filter(
    (name) => !process.env[name]?.trim(),
  )

  if (missingEnvironmentVariables.length > 0) {
    throw new Error(`Thiếu biến môi trường: ${missingEnvironmentVariables.join(', ')}`)
  }

  const { synchronizeTelegramMessages } = await import('./index.js')
  console.log('Bắt đầu đồng bộ Telegram...')
  await synchronizeTelegramMessages()
  console.log('Đồng bộ Telegram hoàn tất.')
}

main().then(() => process.exit(0)).catch(async (error) => {
  const failure = describeTelegramFailure(error)
  console.error(`${failure.title}: ${failure.message}`)

  if (process.env.GITHUB_ACTIONS === 'true') {
    console.error(`::error title=${escapeAnnotation(failure.title)}::${escapeAnnotation(failure.message)}`)
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `## ${failure.title}\n\n${failure.message}\n`)
        .catch(() => console.error('Không thể ghi Job Summary. Xem thông báo lỗi ở trên.'))
    }
  }
  process.exit(1)
})
