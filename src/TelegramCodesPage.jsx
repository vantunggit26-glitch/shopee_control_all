import { useEffect, useMemo, useState } from 'react'
import {
  App as AntApp,
  Alert,
  Button,
  Card,
  Empty,
  Input,
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
  LinkOutlined,
  MessageOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore'
import { db } from './firebase'

const { Title, Text, Paragraph, Link } = Typography
const filterKeyword = 'Người mới'

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

function normalizeMessage(documentSnapshot) {
  const data = documentSnapshot.data()
  const text = String(data.text || '')
  const links = Array.isArray(data.links) ? data.links : extractLinks(text)
  const detectedCodes = Array.isArray(data.detectedCodes) ? data.detectedCodes : extractCodes(text)
  const containsNewUserKeyword = typeof data.containsNewUserKeyword === 'boolean'
    ? data.containsNewUserKeyword
    : normalizeForSearch(text).includes(normalizeForSearch(filterKeyword))

  return {
    id: documentSnapshot.id,
    ...data,
    text,
    links,
    detectedCodes,
    containsNewUserKeyword,
    messageDay: data.messageDay || (data.messageDate?.toDate ? getDayKey(data.messageDate.toDate()) : ''),
  }
}

export default function TelegramCodesPage() {
  const { message } = AntApp.useApp()
  const [telegramMessages, setTelegramMessages] = useState([])
  const [viewFilter, setViewFilter] = useState('today-new-user')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const today = getDayKey(new Date())

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

  const newUserMessagesToday = useMemo(
    () => telegramMessages.filter((item) => item.containsNewUserKeyword && item.messageDay === today),
    [telegramMessages, today],
  )

  const filteredMessages = useMemo(() => {
    const searchText = normalizeForSearch(search.trim())
    return telegramMessages.filter((item) => {
      const matchesView = viewFilter === 'all'
        || (viewFilter === 'today' && item.messageDay === today)
        || (viewFilter === 'new-user' && item.containsNewUserKeyword)
        || (viewFilter === 'today-new-user' && item.messageDay === today && item.containsNewUserKeyword)
      const searchableText = normalizeForSearch([
        item.text,
        ...(item.detectedCodes || []),
        ...(item.links || []),
      ].join(' '))
      return matchesView && (!searchText || searchableText.includes(searchText))
    })
  }, [telegramMessages, today, viewFilter, search])

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
            {record.containsNewUserKeyword && <Tag color="green">Người mới</Tag>}
            <Text type="secondary">#{record.telegramMessageId}</Text>
          </Space>
          <Paragraph ellipsis={{ rows: 3, expandable: true, symbol: 'Xem thêm' }}>{text}</Paragraph>
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
      title: 'Liên kết',
      key: 'links',
      width: 150,
      render: (_value, record) => (
        <Space direction="vertical" size={4}>
          {(record.links || []).slice(0, 2).map((url, index) => (
            <Link key={url} href={url} target="_blank" rel="noopener noreferrer">
              <LinkOutlined /> {index === 0 ? 'Mở ưu đãi' : `Liên kết ${index + 1}`}
            </Link>
          ))}
          {record.sourceLink && (
            <Link href={record.sourceLink} target="_blank" rel="noopener noreferrer">
              <MessageOutlined /> Tin gốc
            </Link>
          )}
        </Space>
      ),
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
          <Text className="section-kicker">KÊNH TELEGRAM RIÊNG TƯ</Text>
          <Title level={2}>Lắng nghe mã</Title>
          <Paragraph type="secondary">
            Chỉ người đã đăng nhập mới xem được. Tin được đồng bộ mỗi giờ và tự xóa sau 5 ngày.
          </Paragraph>
        </div>
        <Space size={12} wrap>
          <Card className="stat-card telegram-stat-card" variant="borderless">
            <Statistic title="Tin trong 5 ngày" value={telegramMessages.length} prefix={<MessageOutlined />} />
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
        description="Nếu tin chỉ có đường dẫn rút gọn và không có mã chữ, hãy dùng nút Mở ưu đãi."
      />

      {error && <Alert className="data-alert telegram-error-alert" type="error" message={error} showIcon closable onClose={() => setError('')} />}

      <Card className="panel-card table-card" title={<Space><MessageOutlined className="panel-title-icon list" /><span>Danh sách mã từ Telegram</span></Space>} extra={(
        <Space wrap>
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
          scroll={{ x: 940 }}
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
