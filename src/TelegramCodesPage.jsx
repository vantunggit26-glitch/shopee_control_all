import { useEffect, useMemo, useState } from 'react'
import {
  App as AntApp,
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Segmented,
  Select,
  Space,
  Table,
  Typography,
} from 'antd'
import {
  DownOutlined,
  CopyOutlined,
  SearchOutlined,
  SyncOutlined,
  UpOutlined,
} from '@ant-design/icons'
import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import { db, FIREBASE_LOGIN_EMAIL, TELEGRAM_SYNC_TRIGGER_URL } from './firebase'
import WebsiteVouchers from './WebsiteVouchers'
import { SavedVouchers, VoucherSaveButton } from './SavedVouchers'
import { useSavedVouchers, voucherBookmark } from './useSavedVouchers'
import { useTelegramHistory } from './useTelegramHistory'
import { OFFER_OPTIONS, matchesOfferFilter, uniqueVouchers, voucherExpiry } from './voucherUtils'

const { Title, Text, Paragraph, Link } = Typography
const FILTER_KEYWORDS = [
  'Người mới',
  'cho đơn đầu tiên',
  'Mã giảm 100K',
  '80K đơn từ 0Đ',
  '100K đơn từ 0Đ',
  '80K/0Đ',
  '100K/0Đ',
  '75K/0Đ',
  '85K/0Đ',
  '90K/0Đ',
  '95K/0Đ',
  '120K/0Đ',
  '110K/0Đ',
]
const DEFAULT_PLATFORM = 'shopee'
const PLATFORM_META = {
  shopee: { label: 'Shopee', color: 'orange' },
  lazada: { label: 'Lazada', color: 'blue' },
}
const PLATFORM_OPTIONS = Object.entries(PLATFORM_META).map(([value, platform]) => ({
  label: platform.label,
  value,
}))
const PUBLIC_CHANNEL_KEY = 'voucher-public'
const AUTHENTICATED_CHANNEL_KEY = 'sale-zero-authenticated'
const CHANNEL_META = {
  all: { label: 'Tất cả kênh' },
  [PUBLIC_CHANNEL_KEY]: { label: 'Săn Voucher Shopee - Lazada', color: 'purple' },
  [AUTHENTICATED_CHANNEL_KEY]: { label: 'Săn Sale 0 đồng', color: 'magenta' },
}
const AUTHENTICATED_CHANNEL_OPTIONS = Object.entries(CHANNEL_META).map(([value, channel]) => ({
  label: channel.label,
  value,
}))
const DEFAULT_SYNC_INTERVAL_MINUTES = 20
const DEFAULT_SYNC_OFFSET_MINUTE = 7

function normalizeForSearch(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('vi')
    .replace(/\s+/gu, ' ')
    .trim()
}

function findMatchedKeyword(text) {
  const normalizedText = normalizeForSearch(text)
  return FILTER_KEYWORDS.find((keyword) => normalizedText.includes(normalizeForSearch(keyword))) || ''
}

function getDayKey(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function formatMessageDate(timestamp) {
  if (!timestamp?.toDate) return 'Đang đồng bộ'

  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(timestamp.toDate())
}

function toDate(value) {
  if (value?.toDate) return value.toDate()
  if (!value) return null

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDateTime(value) {
  const date = toDate(value)
  if (!date) return 'Chưa có dữ liệu'

  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function formatElapsed(value, now) {
  const date = toDate(value)
  if (!date) return 'Chưa đồng bộ'

  const elapsedSeconds = Math.max(0, Math.floor((now - date.getTime()) / 1000))
  if (elapsedSeconds < 60) return 'Vừa xong'
  const elapsedMinutes = Math.floor(elapsedSeconds / 60)
  if (elapsedMinutes < 60) return `${elapsedMinutes} phút trước`
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return `${elapsedHours} giờ trước`
  return `${Math.floor(elapsedHours / 24)} ngày trước`
}

function formatCountdown(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000))
  if (totalSeconds < 60) return `${totalSeconds} giây`
  const totalMinutes = Math.ceil(totalSeconds / 60)
  if (totalMinutes < 60) return `${totalMinutes} phút`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes > 0 ? `${hours} giờ ${minutes} phút` : `${hours} giờ`
}

function getNextScheduledTime(now, intervalMinutes, offsetMinute) {
  const safeInterval = Number.isInteger(intervalMinutes) && intervalMinutes > 0
    ? intervalMinutes
    : DEFAULT_SYNC_INTERVAL_MINUTES
  const safeOffset = Number.isInteger(offsetMinute)
    ? ((offsetMinute % safeInterval) + safeInterval) % safeInterval
    : DEFAULT_SYNC_OFFSET_MINUTE
  let candidate = new Date(now)
  candidate.setUTCSeconds(0, 0)
  candidate = new Date(candidate.getTime() + 60 * 1000)

  for (let index = 0; index <= 60; index += 1) {
    if (candidate.getUTCMinutes() % safeInterval === safeOffset) return candidate
    candidate = new Date(candidate.getTime() + 60 * 1000)
  }

  return new Date(now + safeInterval * 60 * 1000)
}

function extractLinks(text) {
  const matches = String(text || '').match(/https?:\/\/[^\s<>"']+/giu) || []
  return [...new Set(matches.map((link) => link.replace(/[),.;!?]+$/gu, '')))]
}

function extractCodes(text) {
  const textWithoutLinks = String(text || '').replace(/https?:\/\/[^\s<>"']+/giu, ' ')
  const matches = textWithoutLinks.match(/\b(?=[A-Z0-9]{5,24}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*[0-9])[A-Z0-9]+\b/g) || []
  return [...new Set(matches)]
}

function extractCodesFromLinks(links) {
  const codes = []
  for (const value of links) {
    try {
      const url = new URL(value)
      for (const parameterName of ['keyword', 'voucherCode', 'code']) {
        const candidate = url.searchParams.get(parameterName)?.trim() || ''
        if (/^(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{5,40}$/.test(candidate)) codes.push(candidate)
      }
    } catch {
      continue
    }
  }
  return [...new Set(codes)]
}

function detectMessagePlatforms(text, links, resolvedLinks) {
  const searchableText = normalizeForSearch([
    text,
    ...links,
    ...resolvedLinks,
  ].join(' '))
  const platforms = []

  if (searchableText.includes('shopee') || searchableText.includes('shp.ee')) {
    platforms.push('shopee')
  }
  if (searchableText.includes('lazada') || searchableText.includes('lzd.co')) {
    platforms.push('lazada')
  }

  return platforms
}

function renderLinkedMessage(text, links, resolvedLinks) {
  return String(text || '').split(/(https?:\/\/[^\s<>"']+)/giu).map((part, index) => {
    if (!/^https?:\/\//iu.test(part)) return part

    const displayUrl = part.replace(/[),.;!?]+$/gu, '')
    const trailingPunctuation = part.slice(displayUrl.length)
    const linkIndex = links.indexOf(displayUrl)
    const destination = resolvedLinks[linkIndex] || displayUrl

    return (
      <span key={`${displayUrl}-${index}`}>
        <Link className="telegram-inline-link" href={destination} target="_blank" rel="noopener noreferrer">
          {displayUrl}
        </Link>
        {trailingPunctuation}
      </span>
    )
  })
}

function normalizeMessage(documentSnapshot, fallbackChannelKey) {
  const data = documentSnapshot.data()
  const text = String(data.text || '')
  const links = Array.isArray(data.links) ? data.links : extractLinks(text)
  const resolvedLinks = Array.isArray(data.resolvedLinks) ? data.resolvedLinks : links
  const detectedCodes = [...new Set([
    ...(Array.isArray(data.detectedCodes) ? data.detectedCodes : extractCodes(text)),
    ...extractCodesFromLinks(resolvedLinks),
  ])]
  const platforms = detectMessagePlatforms(text, links, resolvedLinks)
  const matchedKeyword = data.matchedKeyword || findMatchedKeyword(text)

  return {
    id: documentSnapshot.id,
    ...data,
    text,
    links,
    resolvedLinks,
    detectedCodes,
    platforms,
    matchedKeyword,
    channelKey: data.channelKey || fallbackChannelKey,
    messageDay: data.messageDay || (data.messageDate?.toDate ? getDayKey(data.messageDate.toDate()) : ''),
  }
}

export default function TelegramCodesPage({ user = null }) {
  const [mode, setMode] = useState('telegram')
  const [showSaved, setShowSaved] = useState(false)
  const savedVouchers = useSavedVouchers(user?.uid)
  const saved = user?.uid ? savedVouchers : null
  const subtitle = mode === 'website' ? 'Ưu đãi Shopee và Lazada tổng hợp từ VoucherSan.'
    : user?.uid
      ? 'Theo dõi ưu đãi từ các kênh công khai và kênh dành cho tài khoản đăng nhập.'
      : 'Theo dõi ưu đãi từ kênh công khai. Đăng nhập để xem thêm kênh riêng.'

  return (
    <>
      <section className="telegram-page-heading">
        <div>
          <Title level={2}>Mã giảm giá</Title>
          <Paragraph type="secondary">{subtitle}</Paragraph>
        </div>
        <div className="voucher-heading-actions">
          <div className="voucher-mode-picker">
            <span>Chế độ bảng</span>
            <Segmented
              value={mode}
              onChange={(value) => { setMode(value); setShowSaved(false) }}
              options={[{ value: 'telegram', label: 'Telegram' }, { value: 'website', label: 'Website' }]}
              aria-label="Chọn chế độ bảng mã giảm giá"
            />
          </div>
          {saved && (
            <Button type={showSaved ? 'primary' : 'default'} aria-pressed={showSaved}
              onClick={() => setShowSaved((value) => !value)}>Mã đã lưu ({saved.items.length})</Button>
          )}
        </div>
      </section>
      {showSaved && saved ? <SavedVouchers saved={saved} /> : mode === 'website'
        ? <WebsiteVouchers saved={saved} /> : <TelegramVouchers key={user?.uid || 'guest'} user={user} saved={saved} />}
    </>
  )
}

function TelegramVouchers({ user, saved }) {
  const { message } = AntApp.useApp()
  const [platformFilter, setPlatformFilter] = useState(DEFAULT_PLATFORM)
  const [channelFilter, setChannelFilter] = useState(user?.uid ? 'all' : PUBLIC_CHANNEL_KEY)
  const [viewFilter, setViewFilter] = useState('today')
  const [offerFilter, setOfferFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [preferenceError, setPreferenceError] = useState('')
  const [syncStatus, setSyncStatus] = useState(null)
  const [syncStatusError, setSyncStatusError] = useState('')
  const [workerStatus, setWorkerStatus] = useState(null)
  const [showSyncLogs, setShowSyncLogs] = useState(false)
  const [isTriggeringSync, setIsTriggeringSync] = useState(false)
  const [triggerCooldownUntil, setTriggerCooldownUntil] = useState(0)
  const [currentTime, setCurrentTime] = useState(() => Date.now())
  const [isPreferenceLoading, setIsPreferenceLoading] = useState(Boolean(user?.uid))
  const [isPreferenceSaving, setIsPreferenceSaving] = useState(false)
  const today = getDayKey(new Date(currentTime))
  const todayStart = Date.parse(`${today}T00:00:00+07:00`)
  const cutoff = viewFilter === 'today' ? todayStart : todayStart - 4 * 86_400_000
  const publicHistory = useTelegramHistory('todo', !isPreferenceLoading && channelFilter !== AUTHENTICATED_CHANNEL_KEY, cutoff)
  const privateHistory = useTelegramHistory('todoAuthenticated',
    Boolean(user?.uid && !isPreferenceLoading && channelFilter !== PUBLIC_CHANNEL_KEY), cutoff, user?.uid)
  const canTrigger = user?.email?.toLowerCase() === FIREBASE_LOGIN_EMAIL

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!user?.uid) return undefined

    return onSnapshot(
      doc(db, '_syncState', 'telegram_automation'),
      (snapshot) => {
        setSyncStatus(snapshot.exists() ? snapshot.data() : null)
        setSyncStatusError('')
      },
      () => {
        setSyncStatusError('Không thể đọc trạng thái GitHub Actions từ Firestore.')
      },
    )
  }, [user?.uid])

  useEffect(() => {
    if (!canTrigger || !TELEGRAM_SYNC_TRIGGER_URL) return undefined
    const lifetime = new AbortController()
    async function readWorkerStatus() {
      try {
        const token = await user.getIdToken()
        const response = await fetch(new URL('status', TELEGRAM_SYNC_TRIGGER_URL), {
          signal: lifetime.signal, headers: { authorization: `Bearer ${token}` },
        })
        if (!response.ok) throw new Error('Worker status unavailable')
        const status = await response.json()
        if (!lifetime.signal.aborted) setWorkerStatus(status)
      } catch {
        if (!lifetime.signal.aborted) setWorkerStatus({ workerError: 'Không đọc được trạng thái Cloudflare.' })
      }
    }
    void readWorkerStatus()
    const interval = window.setInterval(readWorkerStatus, 60_000)
    return () => { lifetime.abort(); window.clearInterval(interval) }
  }, [canTrigger, user])

  useEffect(() => {
    if (!user?.uid) return undefined

    const preferenceRef = doc(db, 'users', user.uid, 'preferences', 'discountCodes')
    const unsubscribe = onSnapshot(
      preferenceRef,
      (snapshot) => {
        const savedPlatform = snapshot.exists() ? snapshot.data().voucherPlatform : ''
        const savedChannel = snapshot.exists() ? snapshot.data().voucherChannel : ''
        if (savedPlatform in PLATFORM_META) setPlatformFilter(savedPlatform)
        if (savedChannel in CHANNEL_META) setChannelFilter(savedChannel)
        setPreferenceError('')
        setIsPreferenceLoading(false)
      },
      () => {
        setPreferenceError('Không thể tải lựa chọn sàn đã lưu cho tài khoản này.')
        setIsPreferenceLoading(false)
      },
    )

    return unsubscribe
  }, [user?.uid])

  const telegramMessages = useMemo(
    () => [
      ...publicHistory.docs.map((item) => normalizeMessage(item, PUBLIC_CHANNEL_KEY)),
      ...privateHistory.docs.map((item) => normalizeMessage(item, AUTHENTICATED_CHANNEL_KEY)),
    ].sort((left, right) => {
      const leftTime = left.messageDate?.toMillis?.() || 0
      const rightTime = right.messageDate?.toMillis?.() || 0
      return rightTime - leftTime
    }),
    [privateHistory.docs, publicHistory.docs],
  )

  const channelMessages = useMemo(
    () => telegramMessages.filter((item) => (
      channelFilter === 'all' || item.channelKey === channelFilter
    )),
    [channelFilter, telegramMessages],
  )

  const platformMessages = useMemo(
    () => channelMessages.filter((item) => item.platforms.includes(platformFilter)),
    [channelMessages, platformFilter],
  )

  const filteredMessages = useMemo(() => {
    const searchText = normalizeForSearch(search.trim())
    const matches = platformMessages.filter((item) => {
      const searchableText = normalizeForSearch([
        item.text,
        ...(item.detectedCodes || []),
        ...(item.links || []),
        ...(item.resolvedLinks || []),
        item.chatTitle,
      ].join(' '))
      return (!searchText || searchableText.includes(searchText))
        && matchesOfferFilter(offerFilter, item.text, voucherExpiry(item.text), currentTime)
    })
    return uniqueVouchers(matches, (item) => normalizeForSearch(item.text))
  }, [platformMessages, offerFilter, currentTime, search])

  const syncView = useMemo(() => {
    const intervalMinutes = Number(syncStatus?.scheduleMinutes)
      || DEFAULT_SYNC_INTERVAL_MINUTES
    const offsetMinute = Number.isInteger(Number(syncStatus?.scheduleOffsetMinute))
      ? Number(syncStatus.scheduleOffsetMinute)
      : DEFAULT_SYNC_OFFSET_MINUTE
    const lastSuccess = toDate(syncStatus?.lastSuccessAt)
    const lastAttempt = toDate(syncStatus?.lastAttemptAt)
    const nextSchedule = getNextScheduledTime(currentTime, intervalMinutes, offsetMinute)
    const staleAfterMs = intervalMinutes * 2 * 60 * 1000
    const referenceDate = syncStatus?.status === 'running' ? lastAttempt : lastSuccess
    const isStale = Boolean(referenceDate && currentTime - referenceDate.getTime() > staleAfterMs)
    let state = syncStatus?.status || 'waiting'
    let label = 'Chờ lần chạy đầu tiên'

    if (state === 'running' && !isStale) label = 'Đang đồng bộ'
    if (state === 'running' && isStale) {
      state = 'stale'
      label = 'Job có thể đang bị treo'
    }
    if (state === 'success' && !isStale) label = 'Hoạt động bình thường'
    if (state === 'success' && isStale) {
      state = 'stale'
      label = 'GitHub Actions đang trễ'
    }
    if (state === 'failure') label = 'Lần chạy gần nhất bị lỗi'
    const latestRun = workerStatus?.github
    const latestRunTime = toDate(latestRun?.createdAt)
    const isLatest = latestRunTime && (!lastAttempt || latestRunTime.getTime() >= lastAttempt.getTime() - 15 * 60_000)
    const pendingDispatch = Number(workerStatus?.acceptedAt) > (lastAttempt?.getTime() || 0) + 2_000
      && currentTime - Number(workerStatus.acceptedAt) < staleAfterMs
    if (latestRun?.status === 'in_progress' && isLatest) {
      state = 'running'
      label = 'GitHub đang chạy'
    } else if (latestRun?.status && latestRun.status !== 'completed' && isLatest) {
      state = 'queued'
      label = 'GitHub đang xếp hàng'
    } else if (latestRun?.status === 'completed' && isLatest && latestRun.conclusion !== 'success'
      && !pendingDispatch) {
      state = 'failure'
      label = 'GitHub báo lỗi'
    } else if (pendingDispatch) {
      state = 'queued'
      label = 'Cloudflare đã gửi yêu cầu'
    }

    return {
      intervalMinutes,
      state,
      label,
      lastSuccess,
      nextSchedule,
      logs: Array.isArray(syncStatus?.logs) ? syncStatus.logs : [],
      stale: Boolean(lastSuccess && currentTime - lastSuccess.getTime() > staleAfterMs),
      newCount: syncStatus?.lastSuccessSummary?.createdCount
        ?? (syncStatus?.status === 'success' ? syncStatus.latestSummary?.createdCount : null),
    }
  }, [currentTime, syncStatus, workerStatus])

  const triggerCooldownSeconds = Math.max(
    0,
    Math.ceil((triggerCooldownUntil - currentTime) / 1000),
  )

  async function triggerTelegramSync() {
    if (!canTrigger || isTriggeringSync || triggerCooldownSeconds > 0) return
    if (!TELEGRAM_SYNC_TRIGGER_URL) {
      message.error('Endpoint đồng bộ thủ công chưa được cấu hình.')
      return
    }

    setIsTriggeringSync(true)
    try {
      const idToken = await user.getIdToken()
      const response = await fetch(TELEGRAM_SYNC_TRIGGER_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${idToken}`,
          'content-type': 'application/json',
        },
      })
      const payload = await response.json().catch(() => ({}))
      if (response.status === 409) {
        setTriggerCooldownUntil(Date.now() + 30_000)
        message.info(payload.error || 'Một lượt đồng bộ đang chạy.')
        return
      }
      if (!response.ok) {
        throw new Error(payload.error || 'Không thể gửi yêu cầu đồng bộ.')
      }

      setTriggerCooldownUntil(Date.now() + 60_000)
      setCurrentTime(Date.now())
      setWorkerStatus((status) => ({
        ...status, acceptedAt: Date.now(), dispatch: { outcome: 'sent', at: Date.now() },
      }))
      message.success(payload.message || 'Đã gửi yêu cầu đồng bộ tới GitHub Actions.')
    } catch (triggerError) {
      message.error(triggerError.message || 'Không thể chạy đồng bộ thủ công.')
    } finally {
      setIsTriggeringSync(false)
    }
  }

  async function changePlatform(value) {
    if (!(value in PLATFORM_META) || value === platformFilter) return

    const previousPlatform = platformFilter
    setPlatformFilter(value)
    setPreferenceError('')
    if (!user?.uid) return

    setIsPreferenceSaving(true)
    try {
      await setDoc(doc(db, 'users', user.uid, 'preferences', 'discountCodes'), {
        voucherPlatform: value,
        voucherChannel: channelFilter,
        updatedAt: serverTimestamp(),
      }, { merge: true })
      message.success(`Đã lưu lựa chọn ${PLATFORM_META[value].label} cho tài khoản`)
    } catch {
      setPlatformFilter(previousPlatform)
      setPreferenceError('Không thể lưu lựa chọn sàn cho tài khoản. Vui lòng thử lại.')
    } finally {
      setIsPreferenceSaving(false)
    }
  }

  async function changeChannel(value) {
    if (!user?.uid || !(value in CHANNEL_META) || value === channelFilter) return

    const previousChannel = channelFilter
    setChannelFilter(value)
    setPreferenceError('')
    setIsPreferenceSaving(true)
    try {
      await setDoc(doc(db, 'users', user.uid, 'preferences', 'discountCodes'), {
        voucherPlatform: platformFilter,
        voucherChannel: value,
        updatedAt: serverTimestamp(),
      }, { merge: true })
      message.success(`Đã chuyển sang ${CHANNEL_META[value].label}`)
    } catch {
      setChannelFilter(previousChannel)
      setPreferenceError('Không thể lưu lựa chọn kênh. Vui lòng thử lại.')
    } finally {
      setIsPreferenceSaving(false)
    }
  }

  async function copyValue(value, successMessage) {
    try {
      await navigator.clipboard.writeText(value)
      message.success(successMessage)
    } catch {
      message.error('Trình duyệt không cho phép sao chép')
    }
  }

  const columns = [
    {
      title: 'Tin nhắn',
      dataIndex: 'text',
      key: 'text',
      render: (text, record) => (
        <div className="telegram-message-cell">
          <div className="telegram-message-meta">
            <span>{record.platforms.map((platform) => PLATFORM_META[platform].label).join(' · ') || 'Chưa rõ sàn'}</span>
            {record.matchedKeyword && <span>{record.matchedKeyword}</span>}
            <span>{CHANNEL_META[record.channelKey]?.label || record.chatTitle || 'Telegram'}</span>
            <span>#{record.telegramMessageId}</span>
            {record.sourceLink && (
              <Link href={record.sourceLink} target="_blank" rel="noopener noreferrer">
                Mở tin gốc
              </Link>
            )}
            <VoucherSaveButton saved={saved} offer={voucherBookmark(
              'telegram', text, record.resolvedLinks[0] || record.links[0] || record.sourceLink, voucherExpiry(text),
            )} />
          </div>
          <Paragraph ellipsis={{ rows: 4, expandable: true, symbol: 'Xem thêm' }}>
            {renderLinkedMessage(text, record.links || [], record.resolvedLinks || record.links || [])}
          </Paragraph>
        </div>
      ),
    },
    {
      title: 'Mã',
      dataIndex: 'detectedCodes',
      key: 'detectedCodes',
      width: 175,
      render: (codes = []) => codes.length > 0 ? (
        <Space size={[4, 4]} wrap>
          {codes.map((code) => (
            <Button className="telegram-code-button" key={code} size="small" icon={<CopyOutlined />} onClick={() => copyValue(code, `Đã sao chép ${code}`)}>
              {code}
            </Button>
          ))}
        </Space>
      ) : <Text type="secondary">Chỉ có nội dung/link</Text>,
    },
    {
      title: 'Thời gian',
      dataIndex: 'messageDate',
      key: 'messageDate',
      width: 145,
      render: (messageDate) => <span className="telegram-date">{formatMessageDate(messageDate)}</span>,
    },
  ]

  const historyError = publicHistory.error || privateHistory.error
  const hasMore = publicHistory.hasMore || privateHistory.hasMore
  const dispatch = workerStatus?.dispatch
  const dispatchLabel = { sent: 'Đã gửi yêu cầu', skipped: 'Bỏ qua vì có lượt đang chạy', failed: 'Gửi yêu cầu thất bại' }

  return (
    <>
      {user?.uid && (
        <section className={`telegram-sync-status is-${syncView.state}`} aria-label="Trạng thái đồng bộ GitHub Actions">
          <div className="telegram-sync-status-main">
            <div className="telegram-sync-state">
              <span className="telegram-sync-dot" aria-hidden="true" />
              <div>
                <Text type="secondary">Đồng bộ Telegram</Text>
                <strong>{syncView.label}</strong>
              </div>
            </div>
            <div className="telegram-sync-metric">
              <Text type="secondary">Thành công gần nhất</Text>
              <strong>{formatElapsed(syncView.lastSuccess, currentTime)}</strong>
              <span>{formatDateTime(syncView.lastSuccess)}</span>
              {Number.isFinite(syncView.newCount) && <span>{syncView.newCount} tin mới</span>}
            </div>
            <div className="telegram-sync-metric">
              <Text type="secondary">Lượt lịch kế tiếp</Text>
              <strong>Sau {formatCountdown(syncView.nextSchedule.getTime() - currentTime)}</strong>
              <span>Cloudflare đặt lịch mỗi {syncView.intervalMinutes} phút</span>
            </div>
            <div className="telegram-sync-actions">
              {canTrigger && <Button
                icon={<SyncOutlined />}
                loading={isTriggeringSync}
                disabled={['running', 'queued'].includes(syncView.state) || triggerCooldownSeconds > 0}
                onClick={triggerTelegramSync}
              >
                {triggerCooldownSeconds > 0
                  ? `Chờ ${triggerCooldownSeconds}s`
                  : 'Đồng bộ ngay'}
              </Button>}
              <Button
                className="telegram-sync-log-toggle"
                type="text"
                icon={showSyncLogs ? <UpOutlined /> : <DownOutlined />}
                onClick={() => setShowSyncLogs((visible) => !visible)}
              >
                Nhật ký ({syncView.logs.length})
              </Button>
            </div>
          </div>

          {dispatch && (
            <div className="voucher-sync-detail">
              Cloudflare · {dispatchLabel[dispatch.outcome]} · {formatDateTime(dispatch.at)}
              {dispatch.error ? ` · ${dispatch.error}` : ''}
              {workerStatus.github?.url && <Link href={workerStatus.github.url} target="_blank" rel="noopener noreferrer">Mở lượt chạy GitHub</Link>}
            </div>
          )}
          {(workerStatus?.workerError || workerStatus?.githubError) && (
            <div className="voucher-sync-detail">{workerStatus.workerError || workerStatus.githubError}</div>
          )}
          {(syncView.state === 'failure' || syncView.state === 'stale' || syncView.stale) && (
            <div className="telegram-sync-notice">
              {syncView.state === 'failure'
                ? (syncStatus?.lastError || 'Xem lượt chạy GitHub để kiểm tra lỗi gần nhất.')
                : `Đã hơn ${syncView.intervalMinutes * 2} phút kể từ lần đồng bộ thành công.`}
            </div>
          )}

          {showSyncLogs && (
            <div className="telegram-sync-logs">
              {syncView.logs.length > 0 ? syncView.logs.map((log, index) => (
                <div className={`telegram-sync-log is-${log.status}`} key={`${log.runId || 'run'}-${log.attempt || 1}-${index}`}>
                  <span className="telegram-sync-log-time">{formatDateTime(log.completedAt || log.startedAt)}</span>
                  <span className="telegram-sync-log-message">{log.message || 'Không có nội dung log.'}</span>
                  {log.runUrl && (
                    <Link href={log.runUrl} target="_blank" rel="noopener noreferrer">Mở GitHub</Link>
                  )}
                </div>
              )) : (
                <Text type="secondary">Nhật ký sẽ xuất hiện sau lần chạy workflow tiếp theo.</Text>
              )}
            </div>
          )}
        </section>
      )}

      {syncStatusError && <Alert className="telegram-error-alert" type="warning" message={syncStatusError} showIcon />}

      {preferenceError && <Alert className="telegram-error-alert" type="warning" message={preferenceError} showIcon closable onClose={() => setPreferenceError('')} />}

      {historyError && <Alert className="data-alert telegram-error-alert" type="error" message={historyError} showIcon />}

      <Card className="panel-card telegram-list-card">
        <div className="telegram-list-heading">
          <div>
            <Title level={4}>Danh sách ưu đãi</Title>
            <Text type="secondary">Dữ liệu được giữ trong 5 ngày và cập nhật tự động.</Text>
          </div>
          <Text type="secondary">{filteredMessages.length} kết quả đã tải</Text>
        </div>
        <div className={`telegram-toolbar ${user?.uid ? '' : 'is-guest'}`}>
          {user?.uid && (
            <label className="telegram-filter-field">
              <span>Kênh</span>
              <Select
                className="telegram-channel-filter"
                value={channelFilter}
                options={AUTHENTICATED_CHANNEL_OPTIONS}
                disabled={isPreferenceLoading || isPreferenceSaving}
                onChange={changeChannel}
                aria-label="Chọn kênh Telegram"
              />
            </label>
          )}
          <label className="telegram-filter-field">
            <span>Sàn</span>
            <Segmented
              className="telegram-platform-filter"
              value={platformFilter}
              options={PLATFORM_OPTIONS}
              disabled={isPreferenceLoading || isPreferenceSaving}
              onChange={changePlatform}
              aria-label="Chọn sàn thương mại điện tử"
            />
          </label>
          <label className="telegram-filter-field">
            <span>Thời gian</span>
            <Select
              className="telegram-filter-select"
              value={viewFilter}
              onChange={setViewFilter}
              options={[
                { value: 'today', label: 'Hôm nay' },
                { value: 'all', label: '5 ngày gần đây' },
              ]}
            />
          </label>
          <label className="telegram-filter-field">
            <span>Ưu đãi</span>
            <Select value={offerFilter} options={OFFER_OPTIONS} onChange={setOfferFilter}
              aria-label="Lọc loại ưu đãi Telegram" />
          </label>
          <label className="telegram-filter-field telegram-search-field">
            <span>Tìm kiếm</span>
            <Input
              className="telegram-search-input"
              prefix={<SearchOutlined />}
              placeholder="Nội dung, mã hoặc link"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              allowClear
            />
          </label>
        </div>
        <Table
          className="telegram-table"
          rowKey="id"
          columns={columns}
          dataSource={filteredMessages}
          loading={isPreferenceLoading || publicHistory.loading || privateHistory.loading}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          scroll={{ x: 780 }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={hasMore ? 'Tải thêm để tìm trong các tin cũ hơn.' : 'Chưa có tin Telegram trong bộ lọc này'}
              />
            ),
          }}
        />
        {hasMore && (
          <div className="voucher-load-more">
            <Button loading={publicHistory.loadingMore || privateHistory.loadingMore}
              onClick={() => { void publicHistory.loadMore(); void privateHistory.loadMore() }}>Tải thêm tin Telegram</Button>
          </div>
        )}
      </Card>
    </>
  )
}
