export const MAX_NOTE_LENGTH = 5000

export function getNoteUrl(text) {
  const value = String(text || '').trim()
  if (!/^(https?:\/\/|www\.)\S+$/i.test(value)) return null

  try {
    const url = new URL(/^www\./i.test(value) ? `https://${value}` : value)
    return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url.href : null
  } catch {
    return null
  }
}
