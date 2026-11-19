const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const version = 1
const proof = 'account-vault/password-vault/v1'

function encodeBytes(buffer) {
  const characters = Array.from(new Uint8Array(buffer), (byte) => String.fromCharCode(byte)).join('')
  return btoa(characters).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function decodeBytes(text) {
  return Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0))
}

async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: decodeBytes(salt), iterations: 600_000 },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

export async function sealVaultValue(key, value, context) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(context) },
    key, encoder.encode(JSON.stringify(value)),
  )
  return { iv: encodeBytes(iv), payload: encodeBytes(encrypted) }
}

export async function openVaultValue(key, encrypted, context) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decodeBytes(encrypted.iv), additionalData: encoder.encode(context) },
    key, decodeBytes(encrypted.payload),
  )
  return JSON.parse(decoder.decode(plain))
}

export async function createVault(password, uid) {
  const salt = encodeBytes(crypto.getRandomValues(new Uint8Array(16)))
  const key = await deriveKey(password, salt)
  const { iv, payload: check } = await sealVaultValue(key, proof, `${uid}/vaultSettings/passwords`)
  return { key, settings: { version, salt, iv, check } }
}

export async function unlockVault(password, uid, settings) {
  if (settings.version !== version) throw new Error('Unsupported vault version')
  const key = await deriveKey(password, settings.salt)
  const value = await openVaultValue(key, { iv: settings.iv, payload: settings.check }, `${uid}/vaultSettings/passwords`)
  if (value !== proof) throw new Error('Invalid vault proof')
  return key
}
