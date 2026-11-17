function normalizeApiId(value) {
  const text = String(value || '').trim()
  if (!/^\d+$/.test(text)) return null
  const id = Number(text)
  return Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null
}

function normalizeApiHash(value) {
  const text = String(value || '').trim()
  return /^[a-f0-9]{32}$/i.test(text) ? text : null
}

function normalizePhone(value) {
  let phone = String(value || '').trim().replace(/[\s()-]/g, '')
  if (/^0\d{9}$/.test(phone)) phone = `+84${phone.slice(1)}`
  else if (/^84\d{9}$/.test(phone)) phone = `+${phone}`
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null
}

export async function collectSessionInput({ env = {}, ask, onInvalid = () => {}, onValid = () => {} }) {
  const fields = [
    {
      name: 'apiId', env: 'TELEGRAM_API_ID',
      prompt: '[1/3] Telegram API ID (chỉ nhập dãy số): ',
      normalize: normalizeApiId,
      invalid: 'API ID không hợp lệ. Chỉ dán dãy số api_id lấy tại my.telegram.org/apps, không nhập lệnh CMD hoặc API Hash.',
    },
    {
      name: 'apiHash', env: 'TELEGRAM_API_HASH', hidden: true,
      prompt: '[2/3] Telegram API Hash (32 ký tự, nhập ẩn): ',
      normalize: normalizeApiHash,
      invalid: 'API Hash không hợp lệ. Cần đúng 32 ký tự gồm 0-9 và a-f từ my.telegram.org/apps; đây không phải mật khẩu hay token BotFather.',
    },
    {
      name: 'phone', env: 'TELEGRAM_PHONE',
      prompt: '[3/3] Số điện thoại Telegram (ví dụ +84901234567): ',
      normalize: normalizePhone,
      invalid: 'Số điện thoại không hợp lệ. Nhập +mã_quốc_gia và số điện thoại; số Việt Nam dạng 09... cũng được chấp nhận.',
    },
  ]
  const result = {}
  for (const field of fields) {
    const configured = env[field.env]?.trim()
    let value = configured ? field.normalize(configured) : null
    if (configured && value === null) onInvalid(field.invalid)
    while (value === null) {
      value = field.normalize(await ask(field.prompt, Boolean(field.hidden)))
      if (value === null) onInvalid(field.invalid)
    }
    result[field.name] = value
    onValid(field.name)
  }
  return result
}
