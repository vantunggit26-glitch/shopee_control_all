export const OFFER_OPTIONS = [
  { value: 'all', label: 'Tất cả ưu đãi' },
  { value: 'zero', label: 'Đơn 0đ' },
  { value: 'expiring', label: 'Sắp hết hạn' },
]

export function voucherText(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('vi').replace(/\s+/gu, ' ').trim()
}

export function voucherExpiry(text) {
  const match = String(text).match(/(?:\bhsd|hết hạn|hạn dùng)\s*:?\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?!\d)/iu)
  if (!match) return null
  const [, day, month, year] = match
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  const midnight = new Date(`${date}T00:00:00Z`)
  if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== date) return null
  return Date.parse(`${date}T23:59:59+07:00`)
}

export function matchesOfferFilter(filter, text, expiry, now) {
  if (filter === 'zero') {
    return /(?:(?<![\p{L}\d])đơn\s*(?:từ\s*)?0\s*(?:đ|₫)|\d\s*k\s*\/\s*0\s*(?:đ|₫)|không (?:cần|yêu cầu) (?:giá trị )?đơn tối thiểu)(?![\p{L}\d])/u.test(voucherText(text))
  }
  if (filter === 'expiring') return Number.isFinite(expiry) && expiry >= now && expiry - now <= 86_400_000
  return true
}

export function uniqueVouchers(items, signature) {
  const seen = new Set()
  return items.filter((item) => {
    const key = signature(item)
    if (!key) return true
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function safeVoucherUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol === 'http:') url.protocol = 'https:'
    return url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 2048 ? url.href : ''
  } catch {
    return ''
  }
}

export function voucherSaveKey(offer) {
  return JSON.stringify([offer.source, offer.title, offer.url])
}
