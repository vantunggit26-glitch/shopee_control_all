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
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import { db, TELEGRAM_SYNC_TRIGGER_URL } from './firebase'

const { Title, Text, Paragraph, Link } = Typography
const FILTER_KEYWORDS = [
  'Người mới',
  'cho đơn đầu tiên',
  'Mã giảm 100K',
  '80K đơn từ 0Đ',
  '100K đơn từ 0Đ',
]
const filterKeyword = FILTER_KEYWORDS[0]
const MESSAGE_QUERY_LIMIT = 1000
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
const DEFAULT_SYNC_INTERVAL_MINUTES = 10
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
  const containsNewUserKeyword = typeof data.containsNewUserKeyword === 'boolean'
    ? data.containsNewUserKeyword
    : normalizeForSearch(text).includes(normalizeForSearch(filterKeyword))
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
    containsNewUserKeyword,
    channelKey: data.channelKey || fallbackChannelKey,
    messageDay: data.messageDay || (data.messageDate?.toDate ? getDayKey(data.messageDate.toDate()) : ''),
  }
}

export default function TelegramCodesPage({ user = null }) {
  const { message } = AntApp.useApp()
  const [publicMessages, setPublicMessages] = useState([])
  const [authenticatedMessages, setAuthenticatedMessages] = useState([])
  const [platformFilter, setPlatformFilter] = useState(DEFAULT_PLATFORM)
  const [channelFilter, setChannelFilter] = useState(user?.uid ? 'all' : PUBLIC_CHANNEL_KEY)
  const [viewFilter, setViewFilter] = useState('today')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [preferenceError, setPreferenceError] = useState('')
  const [syncStatus, setSyncStatus] = useState(null)
  const [syncStatusError, setSyncStatusError] = useState('')
  const [showSyncLogs, setShowSyncLogs] = useState(false)
  const [isTriggeringSync, setIsTriggeringSync] = useState(false)
  const [triggerCooldownUntil, setTriggerCooldownUntil] = useState(0)
  const [currentTime, setCurrentTime] = useState(() => Date.now())
  const [isPublicLoading, setIsPublicLoading] = useState(true)
  const [isAuthenticatedLoading, setIsAuthenticatedLoading] = useState(Boolean(user?.uid))
  const [isPreferenceLoading, setIsPreferenceLoading] = useState(Boolean(user?.uid))
  const [isPreferenceSaving, setIsPreferenceSaving] = useState(false)
  const today = getDayKey(new Date())

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

  useEffect(() => {
    const messagesQuery = query(
      collection(db, 'todo'),
      orderBy('messageDate', 'desc'),
      limit(MESSAGE_QUERY_LIMIT),
    )
    const unsubscribe = onSnapshot(
      messagesQuery,
      (snapshot) => {
        setPublicMessages(snapshot.docs.map((item) => normalizeMessage(item, PUBLIC_CHANNEL_KEY)))
        setError('')
        setIsPublicLoading(false)
      },
      () => {
        setError('Không thể tải tin Telegram. Hãy kiểm tra Firestore Rules đã được triển khai.')
        setIsPublicLoading(false)
      },
    )

    return unsubscribe
  }, [])

  useEffect(() => {
    if (!user?.uid) return undefined

    const messagesQuery = query(
      collection(db, 'todoAuthenticated'),
      orderBy('messageDate', 'desc'),
      limit(MESSAGE_QUERY_LIMIT),
    )
    return onSnapshot(
      messagesQuery,
      (snapshot) => {
        setAuthenticatedMessages(snapshot.docs.map((item) => (
          normalizeMessage(item, AUTHENTICATED_CHANNEL_KEY)
        )))
        setError('')
        setIsAuthenticatedLoading(false)
      },
      () => {
        setError('Không thể tải kênh dành cho tài khoản đăng nhập. Hãy kiểm tra Firestore Rules.')
        setIsAuthenticatedLoading(false)
      },
    )
  }, [user?.uid])

  const telegramMessages = useMemo(
    () => [...publicMessages, ...authenticatedMessages].sort((left, right) => {
      const leftTime = left.messageDate?.toMillis?.() || 0
      const rightTime = right.messageDate?.toMillis?.() || 0
      return rightTime - leftTime
    }),
    [authenticatedMessages, publicMessages],
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

  const newUserMessagesToday = useMemo(
    () => platformMessages.filter((item) => item.containsNewUserKeyword && item.messageDay === today),
    [platformMessages, today],
  )

  const filteredMessages = useMemo(() => {
    const searchText = normalizeForSearch(search.trim())
    return platformMessages.filter((item) => {
      const matchesView = viewFilter === 'all'
        || (viewFilter === 'today' && item.messageDay === today)
        || (viewFilter === 'new-user' && item.containsNewUserKeyword)
        || (viewFilter === 'today-new-user' && item.messageDay === today && item.containsNewUserKeyword)
      const searchableText = normalizeForSearch([
        item.text,
        ...(item.detectedCodes || []),
        ...(item.links || []),
        ...(item.resolvedLinks || []),
        item.chatTitle,
      ].join(' '))
      return matchesView && (!searchText || searchableText.includes(searchText))
    })
  }, [platformMessages, today, viewFilter, search])

  const syncView = useMemo(() => {
    const intervalMinutes = Number(syncStatus?.scheduleMinutes)
      || DEFAULT_SYNC_INTERVAL_MINUTES
    const offsetMinute = Number.isInteger(Number(syncStatus?.scheduleOffsetMinute))
      ? Number(syncStatus.scheduleOffsetMinute)
      : DEFAULT_SYNC_OFFSET_MINUTE
    const lastSuccess = toDate(syncStatus?.lastSuccessAt)
    const lastAttempt = toDate(syncStatus?.lastAttemptAt)
    const nextSchedule = getNextScheduledTime(currentTime, intervalMinutes, offsetMinute)
    const staleAfterMs = intervalMinutes * 2.5 * 60 * 1000
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

    return {
      intervalMinutes,
      state,
      label,
      lastSuccess,
      nextSchedule,
      logs: Array.isArray(syncStatus?.logs) ? syncStatus.logs : [],
    }
  }, [currentTime, syncStatus])

  const triggerCooldownSeconds = Math.max(
    0,
    Math.ceil((triggerCooldownUntil - currentTime) / 1000),
  )

  async function triggerTelegramSync() {
    if (!user?.uid || isTriggeringSync || triggerCooldownSeconds > 0) return
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

  return (
    <>
      <section className="telegram-page-heading">
        <div>
          <Title level={2}>Mã giảm giá</Title>
          <Paragraph type="secondary">
            {user?.uid
              ? 'Theo dõi ưu đãi từ các kênh công khai và kênh dành cho tài khoản đăng nhập.'
              : 'Theo dõi ưu đãi từ kênh công khai. Đăng nhập để xem thêm kênh riêng.'}
          </Paragraph>
        </div>
        <div className="telegram-summary" aria-label="Thống kê mã giảm giá">
          <div><strong>{platformMessages.length}</strong><span>Tin trong 5 ngày</span></div>
          <div><strong>{newUserMessagesToday.length}</strong><span>Người mới hôm nay</span></div>
        </div>
      </section>

      {user?.uid && (
        <section className={`telegram-sync-status is-${syncView.state}`} aria-label="Trạng thái đồng bộ GitHub Actions">
          <div className="telegram-sync-status-main">
            <div className="telegram-sync-state">
              <span className="telegram-sync-dot" aria-hidden="true" />
              <div>
                <Text type="secondary">GitHub Actions</Text>
                <strong>{syncView.label}</strong>
              </div>
            </div>
            <div className="telegram-sync-metric">
              <Text type="secondary">Thành công gần nhất</Text>
              <strong>{formatElapsed(syncView.lastSuccess, currentTime)}</strong>
              <span>{formatDateTime(syncView.lastSuccess)}</span>
            </div>
            <div className="telegram-sync-metric">
              <Text type="secondary">Lượt lịch kế tiếp</Text>
              <strong>Sau {formatCountdown(syncView.nextSchedule.getTime() - currentTime)}</strong>
              <span>Mỗi {syncView.intervalMinutes} phút · GitHub có thể trì hoãn</span>
            </div>
            <div className="telegram-sync-actions">
              <Button
                icon={<SyncOutlined />}
                loading={isTriggeringSync}
                disabled={syncView.state === 'running' || triggerCooldownSeconds > 0}
                onClick={triggerTelegramSync}
              >
                {triggerCooldownSeconds > 0
                  ? `Chờ ${triggerCooldownSeconds}s`
                  : 'Đồng bộ ngay'}
              </Button>
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

          {(syncView.state === 'failure' || syncView.state === 'stale') && (
            <div className="telegram-sync-notice">
              {syncView.state === 'failure'
                ? (syncStatus?.lastError || 'Job đã kết thúc với lỗi nhưng chưa có nội dung chi tiết.')
                : `Không có lần đồng bộ thành công trong hơn ${Math.ceil(syncView.intervalMinutes * 2.5)} phút.`}
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

      {error && <Alert className="data-alert telegram-error-alert" type="error" message={error} showIcon closable onClose={() => setError('')} />}

      <Card className="panel-card telegram-list-card">
        <div className="telegram-list-heading">
          <div>
            <Title level={4}>Danh sách ưu đãi</Title>
            <Text type="secondary">Dữ liệu được giữ trong 5 ngày và cập nhật tự động.</Text>
          </div>
          <Text type="secondary">{filteredMessages.length} kết quả</Text>
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
                { value: 'today-new-user', label: 'Người mới hôm nay' },
                { value: 'new-user', label: 'Người mới trong 5 ngày' },
              ]}
            />
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
          loading={isPublicLoading || isAuthenticatedLoading}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          scroll={{ x: 780 }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={search ? 'Không tìm thấy tin phù hợp' : 'Chưa có tin Telegram trong bộ lọc này'}
              />
            ),
          }}
        />
      </Card>
    </>
  )
}
