import { useEffect, useRef, useState } from 'react'
import { Timestamp, collection, getDocs, limit, onSnapshot, orderBy, query, startAfter, where } from 'firebase/firestore'
import { db } from './firebase'

const pageSize = 40
const empty = { scope: '', docs: [], loading: false, loadingMore: false, hasMore: false, error: '' }

export function useTelegramHistory(collectionName, enabled, cutoff, accessScope = '') {
  const scope = enabled ? `${collectionName}/${cutoff}/${accessScope}` : ''
  const [view, setView] = useState(empty)
  const session = useRef(null)

  useEffect(() => {
    if (!scope) return undefined
    const base = query(collection(db, collectionName),
      where('messageDate', '>=', Timestamp.fromMillis(cutoff)), orderBy('messageDate', 'desc'))
    const current = { base, latest: [], older: new Map(), cursor: null, paging: false, loadedOlder: false, hasMore: false }
    session.current = current

    function update(snapshot) {
      if (session.current !== current) return
      if (!current.loadedOlder) {
        current.cursor = snapshot.docs.at(-1) || null
        current.hasMore = snapshot.size === pageSize
      } else {
        for (const item of current.latest) current.older.set(item.id, item)
        for (const item of snapshot.docs) current.older.delete(item.id)
      }
      current.latest = snapshot.docs
      setView({
        scope, docs: [...current.latest, ...current.older.values()], loading: false,
        loadingMore: current.paging, hasMore: current.hasMore, error: '',
      })
    }

    const unsubscribe = onSnapshot(query(base, limit(pageSize)), update, () => {
      setView({ ...empty, scope, error: 'Không thể tải tin Telegram. Hãy kiểm tra kết nối.' })
    })
    return () => {
      session.current = null
      unsubscribe()
    }
  }, [scope, collectionName, cutoff])

  async function loadMore() {
    const current = session.current
    if (!current?.cursor || !current.hasMore || current.paging || view.scope !== scope) return
    current.paging = true
    current.loadedOlder = true
    setView((previous) => ({ ...previous, loadingMore: true, error: '' }))
    try {
      const snapshot = await getDocs(query(current.base, startAfter(current.cursor), limit(pageSize)))
      if (session.current !== current) return
      const activeIds = new Set(current.latest.map(({ id }) => id))
      for (const item of snapshot.docs) if (!activeIds.has(item.id)) current.older.set(item.id, item)
      current.cursor = snapshot.docs.at(-1) || null
      current.hasMore = snapshot.size === pageSize
      setView({ ...empty, scope, docs: [...current.latest, ...current.older.values()], hasMore: current.hasMore })
    } catch {
      if (session.current === current) {
        setView((previous) => ({ ...previous, loadingMore: false, error: 'Không thể tải thêm tin. Hãy thử lại.' }))
      }
    } finally {
      current.paging = false
    }
  }

  if (!scope) return { ...empty, loadMore }
  return { ...(view.scope === scope ? view : { ...empty, loading: true }), loadMore }
}
