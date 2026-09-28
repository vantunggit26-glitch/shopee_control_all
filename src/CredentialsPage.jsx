import { useEffect, useMemo, useState } from 'react'
import {
  App as AntApp,
  Alert,
  Avatar,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Popconfirm,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd'
import {
  CopyOutlined,
  DeleteOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  GlobalOutlined,
  KeyOutlined,
  LinkOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  UserOutlined,
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
import { db } from './firebase'

const { Title, Text, Paragraph, Link } = Typography

function validateWebUrl(value) {
  try {
    const parsedUrl = new URL(value)
    return parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:'
  } catch {
    return false
  }
}

function getHostname(value) {
  try {
    return new URL(value).hostname
  } catch {
    return value
  }
}

function compareVietnameseText(left, right) {
  return String(left || '').localeCompare(String(right || ''), 'vi', {
    sensitivity: 'base',
    numeric: true,
  })
}

function getTimestampMilliseconds(timestamp) {
  return timestamp?.toMillis?.() ?? timestamp?.toDate?.().getTime?.() ?? 0
}

function formatUpdatedAt(timestamp) {
  if (!timestamp?.toDate) return 'Đang đồng bộ'

  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(timestamp.toDate())
}

export default function CredentialsPage({ user }) {
  const { message } = AntApp.useApp()
  const [form] = Form.useForm()
  const [credentials, setCredentials] = useState([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [revealedIds, setRevealedIds] = useState(() => new Set())

  useEffect(() => {
    const credentialsQuery = query(
      collection(db, 'users', user.uid, 'credentials'),
      orderBy('createdAt', 'desc'),
    )

    const unsubscribe = onSnapshot(
      credentialsQuery,
      (snapshot) => {
        setCredentials(snapshot.docs.map((credentialDoc) => {
          const data = credentialDoc.data()
          return {
            id: credentialDoc.id,
            ...data,
            legacyEncrypted: 'ciphertext' in data,
          }
        }))
        setError('')
        setIsLoading(false)
      },
      () => {
        setError('Không thể tải danh sách đăng nhập. Firestore Rules mới có thể chưa được triển khai.')
        setIsLoading(false)
      },
    )

    return unsubscribe
  }, [user.uid])

  const filteredCredentials = useMemo(() => {
    const searchText = search.trim().toLocaleLowerCase('vi')
    return searchText
      ? credentials.filter((item) => `${item.siteName || ''} ${item.url || ''} ${item.username || ''}`.toLocaleLowerCase('vi').includes(searchText))
      : credentials
  }, [credentials, search])

  async function addCredential(values) {
    if (!validateWebUrl(values.url)) {
      form.setFields([{ name: 'url', errors: ['URL phải bắt đầu bằng http:// hoặc https://'] }])
      return
    }

    setIsSaving(true)
    setError('')
    try {
      await addDoc(collection(db, 'users', user.uid, 'credentials'), {
        siteName: values.siteName.trim(),
        url: values.url.trim(),
        username: values.username.trim(),
        password: values.password,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      form.resetFields()
      message.success('Đã lưu thông tin đăng nhập')
    } catch {
      setError('Không thể lưu thông tin. Firestore Rules mới có thể chưa được triển khai.')
    } finally {
      setIsSaving(false)
    }
  }

  async function removeCredential(id) {
    setDeletingId(id)
    setError('')
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'credentials', id))
      message.success('Đã xóa thông tin đăng nhập')
    } catch {
      setError('Không thể xóa thông tin đăng nhập.')
    } finally {
      setDeletingId('')
    }
  }

  function togglePassword(id) {
    setRevealedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function copyPassword(password) {
    try {
      await navigator.clipboard.writeText(password)
      message.success('Đã sao chép mật khẩu')
    } catch {
      message.error('Trình duyệt không cho phép sao chép')
    }
  }

  const columns = [
    {
      title: 'Trang web',
      key: 'website',
      sorter: (left, right) => compareVietnameseText(left.siteName, right.siteName),
      sortDirections: ['ascend', 'descend'],
      render: (_value, record) => record.legacyEncrypted ? (
        <Space size={12}>
          <Avatar className="website-avatar" icon={<KeyOutlined />} />
          <div className="credential-site-cell">
            <Text strong>Bản ghi mã hóa cũ</Text>
            <Text type="secondary">Không thể đọc sau khi bỏ khóa bảo vệ</Text>
          </div>
        </Space>
      ) : (
        <Space size={12}>
          <Avatar className="website-avatar" icon={<GlobalOutlined />} />
          <div className="credential-site-cell">
            <Text strong>{record.siteName}</Text>
            <Link href={record.url} target="_blank" rel="noreferrer"><LinkOutlined /> {getHostname(record.url)}</Link>
          </div>
        </Space>
      ),
    },
    {
      title: 'Tài khoản',
      dataIndex: 'username',
      key: 'username',
      width: 220,
      render: (username, record) => record.legacyEncrypted
        ? <Text type="secondary">—</Text>
        : <Text copyable={{ text: username, tooltips: ['Sao chép', 'Đã sao chép'] }}>{username}</Text>,
    },
    {
      title: 'Mật khẩu',
      key: 'password',
      width: 240,
      render: (_value, record) => record.legacyEncrypted ? <Text type="secondary">—</Text> : (
        <Space size={4}>
          <Text code className="password-value">{revealedIds.has(record.id) ? record.password : '••••••••••'}</Text>
          <Button type="text" icon={revealedIds.has(record.id) ? <EyeInvisibleOutlined /> : <EyeOutlined />} onClick={() => togglePassword(record.id)} aria-label="Hiện hoặc ẩn mật khẩu" />
          <Button type="text" icon={<CopyOutlined />} onClick={() => copyPassword(record.password)} aria-label="Sao chép mật khẩu" />
        </Space>
      ),
    },
    {
      title: 'Trạng thái',
      key: 'security',
      width: 140,
      sorter: (left, right) => Number(left.legacyEncrypted) - Number(right.legacyEncrypted),
      sortDirections: ['ascend', 'descend'],
      render: (_value, record) => record.legacyEncrypted
        ? <Tag color="warning">Dữ liệu cũ</Tag>
        : <Tag color="blue" icon={<SafetyCertificateOutlined />}>Theo tài khoản</Tag>,
    },
    {
      title: 'Giờ cập nhật',
      key: 'updatedAt',
      width: 170,
      sorter: (left, right) => getTimestampMilliseconds(left.updatedAt || left.createdAt)
        - getTimestampMilliseconds(right.updatedAt || right.createdAt),
      sortDirections: ['descend', 'ascend'],
      render: (_value, record) => (
        <Tag color="success">{formatUpdatedAt(record.updatedAt || record.createdAt)}</Tag>
      ),
    },
    {
      title: '',
      key: 'action',
      width: 64,
      align: 'right',
      render: (_value, record) => (
        <Popconfirm title="Xóa thông tin này?" description="Bản ghi sẽ bị xóa khỏi Firestore." okText="Xóa" cancelText="Hủy" okButtonProps={{ danger: true }} onConfirm={() => removeCredential(record.id)}>
          <Button danger type="text" icon={<DeleteOutlined />} loading={deletingId === record.id} />
        </Popconfirm>
      ),
    },
  ]

  return (
    <>
      <section className="welcome-section credentials-welcome">
        <div>
          <Text className="section-kicker">QUẢN LÝ ĐĂNG NHẬP</Text>
          <Title level={2}>Đăng nhập website</Title>
          <Paragraph type="secondary">Lưu URL cùng tài khoản và mật khẩu, truy cập ngay không cần mở khóa kho.</Paragraph>
        </div>
        <Card className="stat-card" variant="borderless"><Statistic title="Trang đã lưu" value={credentials.length} prefix={<GlobalOutlined />} /></Card>
      </section>

      <Alert
        className="credential-security-note"
        type="info"
        showIcon
        message="Dữ liệu chỉ được đọc bởi tài khoản Firebase của bạn theo Security Rules. Mật khẩu không còn được mã hóa bằng khóa riêng."
      />

      <Card className="panel-card" title={<Space><PlusOutlined className="panel-title-icon add" /><span>Thêm thông tin đăng nhập</span></Space>}>
        <Paragraph type="secondary" className="panel-description">Điền URL cùng tài khoản và mật khẩu của trang đó.</Paragraph>
        <Form form={form} layout="vertical" requiredMark={false} onFinish={addCredential}>
          <div className="credential-form-grid">
            <Form.Item label="Tên trang" name="siteName" rules={[{ required: true, message: 'Nhập tên trang' }, { max: 100 }]}>
              <Input size="large" prefix={<GlobalOutlined />} placeholder="Ví dụ: Shopee Seller Center" maxLength={100} />
            </Form.Item>
            <Form.Item label="Đường dẫn URL" name="url" rules={[{ required: true, message: 'Nhập URL' }, { max: 2048 }]}>
              <Input size="large" prefix={<LinkOutlined />} placeholder="https://seller.shopee.vn" maxLength={2048} />
            </Form.Item>
            <Form.Item label="Tài khoản" name="username" rules={[{ required: true, message: 'Nhập tài khoản' }, { max: 320 }]}>
              <Input size="large" prefix={<UserOutlined />} placeholder="Email hoặc tên đăng nhập" maxLength={320} />
            </Form.Item>
            <Form.Item label="Mật khẩu" name="password" rules={[{ required: true, message: 'Nhập mật khẩu' }, { max: 500 }]}>
              <Input.Password size="large" prefix={<KeyOutlined />} placeholder="Mật khẩu của trang" maxLength={500} autoComplete="new-password" />
            </Form.Item>
          </div>
          <Button type="primary" size="large" htmlType="submit" icon={<PlusOutlined />} loading={isSaving}>Lưu thông tin</Button>
        </Form>
        {error && <Alert className="data-alert" type="error" message={error} showIcon closable onClose={() => setError('')} />}
      </Card>

      <Card className="panel-card table-card" title={<Space><SafetyCertificateOutlined className="panel-title-icon list" /><span>Danh sách trang đã lưu</span></Space>} extra={(
        <Input className="search-input" prefix={<SearchOutlined />} placeholder="Tìm tên trang, URL, tài khoản..." value={search} onChange={(event) => setSearch(event.target.value)} allowClear />
      )}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={filteredCredentials}
          loading={isLoading}
          pagination={false}
          scroll={{ x: 880 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={search ? 'Không tìm thấy trang phù hợp' : 'Chưa lưu thông tin đăng nhập nào'} /> }}
        />
      </Card>
    </>
  )
}
