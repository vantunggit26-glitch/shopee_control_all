import { useEffect, useMemo, useState } from 'react'
import {
  App as AntApp,
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd'
import {
  CopyOutlined,
  DeleteOutlined,
  GiftOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore'
import { db, FIREBASE_LOGIN_EMAIL } from './firebase'

const { Title, Text, Paragraph } = Typography

const DISCOUNT_TYPES = [
  'Siêu hội học đường',
  'Thợ săn cực phẩm',
  'Người mới',
]

const TYPE_COLORS = {
  'Siêu hội học đường': 'blue',
  'Thợ săn cực phẩm': 'magenta',
  'Người mới': 'green',
}

function formatCreatedAt(timestamp) {
  if (!timestamp?.toDate) return 'Đang đồng bộ'

  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(timestamp.toDate())
}

export default function DiscountCodesPage({ user = null }) {
  const { message } = AntApp.useApp()
  const [form] = Form.useForm()
  const [discountCodes, setDiscountCodes] = useState([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const canManage = user?.email === FIREBASE_LOGIN_EMAIL

  useEffect(() => {
    const discountCodesQuery = query(
      collection(db, 'discountCodes'),
      orderBy('createdAt', 'desc'),
    )

    const unsubscribe = onSnapshot(
      discountCodesQuery,
      (snapshot) => {
        setDiscountCodes(snapshot.docs.map((discountCodeDoc) => ({
          id: discountCodeDoc.id,
          ...discountCodeDoc.data(),
        })))
        setError('')
        setIsLoading(false)
      },
      () => {
        setError('Không thể tải mã giảm giá. Firestore Rules mới có thể chưa được triển khai.')
        setIsLoading(false)
      },
    )

    return unsubscribe
  }, [])

  const filteredDiscountCodes = useMemo(() => {
    const searchText = search.trim().toLocaleLowerCase('vi')
    return discountCodes.filter((item) => {
      const matchesType = typeFilter === 'all' || item.type === typeFilter
      const matchesSearch = !searchText || String(item.code || '').toLocaleLowerCase('vi').includes(searchText)
      return matchesType && matchesSearch
    })
  }, [discountCodes, search, typeFilter])

  async function addDiscountCode(values) {
    if (!canManage) return

    setIsSaving(true)
    setError('')
    try {
      await addDoc(collection(db, 'discountCodes'), {
        code: values.code.trim(),
        type: values.type,
        createdAt: serverTimestamp(),
      })
      form.resetFields()
      message.success('Đã thêm mã giảm giá')
    } catch {
      setError('Không thể thêm mã giảm giá. Firestore Rules mới có thể chưa được triển khai.')
    } finally {
      setIsSaving(false)
    }
  }

  async function removeDiscountCode(id) {
    if (!canManage) return

    setDeletingId(id)
    setError('')
    try {
      await deleteDoc(doc(db, 'discountCodes', id))
      message.success('Đã xóa mã giảm giá')
    } catch {
      setError('Không thể xóa mã giảm giá.')
    } finally {
      setDeletingId('')
    }
  }

  async function copyCode(code) {
    try {
      await navigator.clipboard.writeText(code)
      message.success('Đã sao chép mã giảm giá')
    } catch {
      message.error('Trình duyệt không cho phép sao chép')
    }
  }

  const columns = [
    {
      title: 'Mã giảm giá',
      dataIndex: 'code',
      key: 'code',
      render: (code) => (
        <Space>
          <Text code strong>{code}</Text>
          <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => copyCode(code)} aria-label={`Sao chép mã ${code}`} />
        </Space>
      ),
    },
    {
      title: 'Loại mã',
      dataIndex: 'type',
      key: 'type',
      width: 220,
      render: (type) => <Tag color={TYPE_COLORS[type] || 'default'}>{type}</Tag>,
    },
    {
      title: 'Ngày thêm',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: formatCreatedAt,
    },
    ...(canManage ? [{
      title: '',
      key: 'action',
      width: 64,
      align: 'right',
      render: (_value, record) => (
        <Popconfirm title="Xóa mã giảm giá này?" okText="Xóa" cancelText="Hủy" okButtonProps={{ danger: true }} onConfirm={() => removeDiscountCode(record.id)}>
          <Button danger type="text" icon={<DeleteOutlined />} loading={deletingId === record.id} aria-label={`Xóa mã ${record.code}`} />
        </Popconfirm>
      ),
    }] : []),
  ]

  return (
    <>
      <section className="welcome-section discounts-welcome">
        <div>
          <Text className="section-kicker">KHO MÃ CÔNG KHAI</Text>
          <Title level={2}>Mã giảm giá</Title>
          <Paragraph type="secondary">Xem và sao chép mã không cần đăng nhập.</Paragraph>
        </div>
        <Card className="stat-card" variant="borderless">
          <Statistic title="Mã đang có" value={discountCodes.length} prefix={<GiftOutlined />} />
        </Card>
      </section>

      {canManage && (
        <Card className="panel-card" title={<Space><PlusOutlined className="panel-title-icon add" /><span>Thêm mã giảm giá</span></Space>}>
          <Form form={form} layout="vertical" requiredMark={false} onFinish={addDiscountCode} initialValues={{ type: DISCOUNT_TYPES[0] }}>
            <div className="discount-form-grid">
              <Form.Item label="Mã" name="code" rules={[{ required: true, whitespace: true, message: 'Nhập mã giảm giá' }, { max: 100, message: 'Mã tối đa 100 ký tự' }]}>
                <Input size="large" prefix={<GiftOutlined />} placeholder="Nhập mã giảm giá" maxLength={100} />
              </Form.Item>
              <Form.Item label="Loại mã" name="type" rules={[{ required: true, message: 'Chọn loại mã' }]}>
                <Select size="large" options={DISCOUNT_TYPES.map((type) => ({ value: type, label: type }))} />
              </Form.Item>
            </div>
            <Button type="primary" size="large" htmlType="submit" icon={<PlusOutlined />} loading={isSaving}>Lưu mã</Button>
          </Form>
        </Card>
      )}

      {error && <Alert className="data-alert discount-alert" type="error" message={error} showIcon closable onClose={() => setError('')} />}

      <Card className="panel-card table-card" title={<Space><GiftOutlined className="panel-title-icon list" /><span>Danh sách mã</span></Space>} extra={(
        <Space wrap>
          <Select
            className="discount-type-filter"
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: 'all', label: 'Tất cả loại mã' },
              ...DISCOUNT_TYPES.map((type) => ({ value: type, label: type })),
            ]}
          />
          <Input className="search-input" prefix={<SearchOutlined />} placeholder="Tìm mã..." value={search} onChange={(event) => setSearch(event.target.value)} allowClear />
        </Space>
      )}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={filteredDiscountCodes}
          loading={isLoading}
          pagination={false}
          scroll={{ x: 680 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={search || typeFilter !== 'all' ? 'Không tìm thấy mã phù hợp' : 'Chưa có mã giảm giá nào'} /> }}
        />
      </Card>
    </>
  )
}
