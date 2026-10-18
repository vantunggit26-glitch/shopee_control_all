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
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd'
import {
  CalendarOutlined,
  CopyOutlined,
  MessageOutlined,
  SearchOutlined,
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
import { db } from './firebase'

const { Title, Text, Paragraph, Link } = Typography
const filterKeyword = 'Người mới'
const DEFAULT_PLATFORM = 'shopee'
const PLATFORM_META = {
  shopee: { label: 'Shopee', color: 'orange' },
  lazada: { label: 'Lazada', color: 'blue' },
}
const PLATFORM_OPTIONS = Object.entries(PLATFORM_META).map(([value, platform]) => ({
  label: platform.label,
  value,
}))

function normalizeForSearch(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('vi')
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

function normalizeMessage(documentSnapshot) {
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

  return {
    id: documentSnapshot.id,
    ...data,
    text,
    links,
    resolvedLinks,
    detectedCodes,
    platforms,
    containsNewUserKeyword,
    messageDay: data.messageDay || (data.messageDate?.toDate ? getDayKey(data.messageDate.toDate()) : ''),
  }
}

export default function TelegramCodesPage({ user = null }) {
  const { message } = AntApp.useApp()
  const [telegramMessages, setTelegramMessages] = useState([])
  const [platformFilter, setPlatformFilter] = useState(DEFAULT_PLATFORM)
  const [viewFilter, setViewFilter] = useState('today-new-user')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [preferenceError, setPreferenceError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isPreferenceLoading, setIsPreferenceLoading] = useState(Boolean(user?.uid))
  const [isPreferenceSaving, setIsPreferenceSaving] = useState(false)
  const today = getDayKey(new Date())

  useEffect(() => {
    if (!user?.uid) return undefined

    const preferenceRef = doc(db, 'users', user.uid, 'preferences', 'discountCodes')
    const unsubscribe = onSnapshot(
      preferenceRef,
      (snapshot) => {
        const savedPlatform = snapshot.exists() ? snapshot.data().voucherPlatform : ''
        if (savedPlatform in PLATFORM_META) setPlatformFilter(savedPlatform)
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
      limit(500),
    )
    const unsubscribe = onSnapshot(
      messagesQuery,
      (snapshot) => {
        setTelegramMessages(snapshot.docs.map(normalizeMessage))
        setError('')
        setIsLoading(false)
      },
      () => {
        setError('Không thể tải tin Telegram. Hãy kiểm tra Firestore Rules đã được triển khai.')
        setIsLoading(false)
      },
    )

    return unsubscribe
  }, [])

  const platformMessages = useMemo(
    () => telegramMessages.filter((item) => item.platforms.includes(platformFilter)),
    [telegramMessages, platformFilter],
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
      ].join(' '))
      return matchesView && (!searchText || searchableText.includes(searchText))
    })
  }, [platformMessages, today, viewFilter, search])

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
        updatedAt: serverTimestamp(),
      })
      message.success(`Đã lưu lựa chọn ${PLATFORM_META[value].label} cho tài khoản`)
    } catch {
      setPlatformFilter(previousPlatform)
      setPreferenceError('Không thể lưu lựa chọn sàn cho tài khoản. Vui lòng thử lại.')
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
          <Space size={6} wrap>
            {record.platforms.map((platform) => (
              <Tag key={platform} color={PLATFORM_META[platform].color}>{PLATFORM_META[platform].label}</Tag>
            ))}
            {record.containsNewUserKeyword && <Tag color="green">Người mới</Tag>}
            <Text type="secondary">#{record.telegramMessageId}</Text>
            {record.sourceLink && (
              <Link href={record.sourceLink} target="_blank" rel="noopener noreferrer">
                <MessageOutlined /> Tin gốc
              </Link>
            )}
          </Space>
          <Paragraph ellipsis={{ rows: 3, expandable: true, symbol: 'Xem thêm' }}>
            {renderLinkedMessage(text, record.links || [], record.resolvedLinks || record.links || [])}
          </Paragraph>
        </div>
      ),
    },
    {
      title: 'Mã nhận diện',
      dataIndex: 'detectedCodes',
      key: 'detectedCodes',
      width: 190,
      render: (codes = []) => codes.length > 0 ? (
        <Space size={[4, 4]} wrap>
          {codes.map((code) => (
            <Button key={code} size="small" icon={<CopyOutlined />} onClick={() => copyValue(code, `Đã sao chép ${code}`)}>
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
      width: 155,
      render: (messageDate) => <Text type="secondary">{formatMessageDate(messageDate)}</Text>,
    },
  ]

  return (
    <>
      <section className="welcome-section telegram-welcome">
        <div>
          <Text className="section-kicker">KHO MÃ TỰ ĐỘNG</Text>
          <Title level={2}>Mã giảm giá {PLATFORM_META[platformFilter].label}</Title>
          <Paragraph type="secondary">
            Ai cũng có thể xem. Tin được tự phân loại theo sàn, đồng bộ mỗi giờ và xóa sau 5 ngày.
          </Paragraph>
        </div>
        <Space size={12} wrap>
          <Card className="stat-card telegram-stat-card" variant="borderless">
            <Statistic title={`${PLATFORM_META[platformFilter].label} trong 5 ngày`} value={platformMessages.length} prefix={<MessageOutlined />} />
          </Card>
          <Card className="stat-card telegram-stat-card" variant="borderless">
            <Statistic title="Người mới hôm nay" value={newUserMessagesToday.length} prefix={<CalendarOutlined />} />
          </Card>
        </Space>
      </section>

      <Alert
        className="telegram-info-alert"
        type="info"
        showIcon
        message={`Hôm nay có ${newUserMessagesToday.length} tin chứa “${filterKeyword}”.`}
        description="Các đường dẫn trong nội dung có thể bấm để mở trực tiếp ưu đãi."
      />

      {preferenceError && <Alert className="telegram-error-alert" type="warning" message={preferenceError} showIcon closable onClose={() => setPreferenceError('')} />}

      {error && <Alert className="data-alert telegram-error-alert" type="error" message={error} showIcon closable onClose={() => setError('')} />}

      <Card className="panel-card table-card" title={<Space><MessageOutlined className="panel-title-icon list" /><span>Danh sách mã giảm giá {PLATFORM_META[platformFilter].label}</span></Space>} extra={(
        <Space wrap>
          <Segmented
            className="telegram-platform-filter"
            value={platformFilter}
            options={PLATFORM_OPTIONS}
            disabled={isPreferenceLoading || isPreferenceSaving}
            onChange={changePlatform}
            aria-label="Chọn sàn thương mại điện tử"
          />
          <Select
            className="telegram-filter-select"
            value={viewFilter}
            onChange={setViewFilter}
            options={[
              { value: 'today-new-user', label: 'Người mới hôm nay' },
              { value: 'new-user', label: 'Người mới trong 5 ngày' },
              { value: 'today', label: 'Tất cả hôm nay' },
              { value: 'all', label: 'Tất cả trong 5 ngày' },
            ]}
          />
          <Input
            className="telegram-search-input"
            prefix={<SearchOutlined />}
            placeholder="Tìm nội dung, mã hoặc link..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            allowClear
          />
        </Space>
      )}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={filteredMessages}
          loading={isLoading}
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
