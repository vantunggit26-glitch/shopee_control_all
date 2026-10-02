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

console.log('Bắt đầu đồng bộ Telegram theo giờ...')

try {
  await synchronizeTelegramMessages()
  console.log('Đồng bộ Telegram theo giờ hoàn tất.')
  process.exit(0)
} catch (error) {
  console.error(`Đồng bộ Telegram thất bại: ${error.message}`)
  process.exit(1)
}
