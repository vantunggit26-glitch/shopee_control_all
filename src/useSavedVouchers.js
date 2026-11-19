import { useEffect, useState } from 'react'
import { Timestamp, collection, deleteDoc, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { safeVoucherUrl, voucherSaveKey } from './voucherUtils'

export function voucherBookmark(source, title, url, expiresAt) {
  return { source, title: String(title ?? '').trim().slice(0, 520), url: safeVoucherUrl(url), expiresAt }
}

export function useSavedVouchers(uid) {
  const [snapshot, setSnapshot] = useState({ uid: '', items: [], error: '' })
  useEffect(() => {
    if (!uid) return undefined
    return onSnapshot(query(collection(db, 'users', uid, 'savedVouchers'), orderBy('createdAt', 'desc')),
      (data) => setSnapshot({ uid, items: data.docs.map((item) => ({ ...item.data(), id: item.id })), error: '' }),
      () => setSnapshot({ uid, items: [], error: 'Không tải được mã đã lưu.' }))
  }, [uid])
  const items = snapshot.uid === uid ? snapshot.items : []
  const savedKeys = new Set(items.map(voucherSaveKey))

  async function save(offer) {
    if (!uid || !offer.url || !offer.title) return
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(voucherSaveKey(offer)))
    const id = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    const reference = doc(db, 'users', uid, 'savedVouchers', id)
    await runTransaction(db, async (transaction) => {
      if ((await transaction.get(reference)).exists()) return
      transaction.set(reference, {
        source: offer.source,
        title: offer.title,
        url: offer.url,
        createdAt: serverTimestamp(),
        ...(Number.isFinite(offer.expiresAt) ? { expiresAt: Timestamp.fromMillis(offer.expiresAt) } : {}),
      })
    })
  }

  async function remove(id) {
    if (uid) await deleteDoc(doc(db, 'users', uid, 'savedVouchers', id))
  }

  return {
    items, savedKeys, save, remove, loading: Boolean(uid && snapshot.uid !== uid),
    error: snapshot.uid === uid ? snapshot.error : '',
  }
}
