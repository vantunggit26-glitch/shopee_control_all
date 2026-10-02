import { useEffect, useMemo, useState } from 'react'
import {
  App as AntApp,
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  ConfigProvider,
  Empty,
  Form,
  Input,
  Layout,
  Menu,
  Popconfirm,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import viVN from 'antd/locale/vi_VN'
import {
  CloudSyncOutlined,
  DeleteOutlined,
  FileTextOutlined,
  FilterOutlined,
  GiftOutlined,
  KeyOutlined,
  LockOutlined,
  LogoutOutlined,
  MessageOutlined,
  PlusOutlined,
  SafetyCertificateFilled,
  SearchOutlined,
  ShoppingOutlined,
  TruckOutlined,
  UnorderedListOutlined,
  UserOutlined,
  GlobalOutlined,
} from '@ant-design/icons'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { auth, db, FIREBASE_LOGIN_EMAIL } from './firebase'
import CredentialsPage from './CredentialsPage'
import DiscountCodesPage from './DiscountCodesPage'
import ProductsPage from './ProductsPage'
import TelegramCodesPage from './TelegramCodesPage'
import './App.css'

const { Header, Content, Footer } = Layout
const { Title, Text, Paragraph } = Typography

const STATUS_META = {
  'Tài khoản mới': { color: '#1677ff' },
  'Tài khoản shopee mới': { color: '#13c2c2' },
  'Đang đặt đơn': { color: '#2f54eb' },
  'Đã sử dụng shopee': { color: '#52c41a' },
  'Đã khóa mã người mới': { color: '#ad6800' },
  'Đã khóa M02': { color: '#fa8c16' },
  'Đã khóa M04': { color: '#f5222d' },
  'Đã khóa F02': { color: '#722ed1' },
}

const ACCOUNT_STATUSES = Object.keys(STATUS_META)
const STATUS_OPTIONS = ACCOUNT_STATUSES.map((status) => ({
  value: status,
  label: (
    <Space size={8}>
      <Badge color={STATUS_META[status].color} />
      <span>{status}</span>
    </Space>
  ),
}))

function getAuthErrorMessage(error) {
  const messages = {
    'auth/invalid-credential': 'Tên đăng nhập hoặc mật khẩu chưa đúng.',
    'auth/user-disabled': 'Tài khoản này đã bị vô hiệu hóa.',
    'auth/too-many-requests': 'Bạn thử quá nhiều lần. Vui lòng chờ một lúc rồi thử lại.',
    'auth/network-request-failed': 'Không thể kết nối Firebase. Hãy kiểm tra Internet.',
    'auth/operation-not-allowed': 'Đăng nhập Email/Password chưa được bật trên Firebase.',
  }
  return messages[error?.code] || 'Không thể đăng nhập. Vui lòng thử lại.'
}

function formatCompactRelative(timestamp) {
  if (!timestamp?.toDate) return '...'

  const elapsed = Math.max(0, Date.now() - timestamp.toDate().getTime())
  const minutes = Math.floor(elapsed / 60000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`

  return `${Math.floor(days / 7)}t`
}

function formatExactDate(timestamp) {
  if (!timestamp?.toDate) return 'Đang đồng bộ'

  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(timestamp.toDate())
}

function formatElapsedDetail(timestamp) {
  if (!timestamp?.toDate) return 'Đang đồng bộ'

  const totalMinutes = Math.floor(Math.max(0, Date.now() - timestamp.toDate().getTime()) / 60000)
  if (totalMinutes < 1) return 'dưới 1 phút'

  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) return `${days} ngày ${hours} giờ`
  if (hours > 0) return `${hours} giờ ${minutes} phút`
  return `${minutes} phút`
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

function EditableAccountText({ value, placeholder, maxLength, loading, multiline = false, onSave }) {
  const [draft, setDraft] = useState(value || '')

  async function saveDraft() {
    const normalizedValue = draft.trim()
    if (normalizedValue === (value || '')) return

    const saved = await onSave(normalizedValue)
    if (!saved) setDraft(value || '')
  }

  if (multiline) {
    return (
      <Input.TextArea
        className="account-inline-input account-note-input"
        value={draft}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={loading}
        autoSize={{ minRows: 2, maxRows: 2 }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={saveDraft}
      />
    )
  }

  return (
    <Input
      className="account-inline-input"
      size="small"
      value={draft}
      placeholder={placeholder}
      maxLength={maxLength}
      disabled={loading}
      suffix={loading ? <Spin size="small" /> : null}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={saveDraft}
      onPressEnter={(event) => event.currentTarget.blur()}
    />
  )
}

function Login({ onLogin, onViewPublicContent }) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(values) {
    const loginName = values.username.trim().toLowerCase()
    if (loginName !== 'tungtv' && loginName !== FIREBASE_LOGIN_EMAIL) {
      setError('Tên đăng nhập hoặc mật khẩu chưa đúng.')
      return
    }

    setError('')
    setIsSubmitting(true)
    try {
      await onLogin(values.password)
    } catch (loginError) {
      setError(getAuthErrorMessage(loginError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Layout className="login-layout">
      <Content className="login-content">
        <Card className="login-card" variant="borderless">
          <div className="login-brand-icon"><SafetyCertificateFilled /></div>
          <Text className="login-eyebrow">KHÔNG GIAN CÁ NHÂN</Text>
          <Title level={2}>Chào mừng trở lại</Title>
          <Paragraph type="secondary">Đăng nhập để quản lý và đồng bộ tài khoản của bạn.</Paragraph>

          {error && <Alert className="login-alert" message={error} type="error" showIcon closable onClose={() => setError('')} />}

          <Form layout="vertical" requiredMark={false} onFinish={handleSubmit} size="large">
            <Form.Item label="Tên đăng nhập" name="username" rules={[{ required: true, message: 'Vui lòng nhập tên đăng nhập' }]}>
              <Input prefix={<UserOutlined />} placeholder="tungtv" autoComplete="username" autoFocus />
            </Form.Item>
            <Form.Item label="Mật khẩu" name="password" rules={[{ required: true, message: 'Vui lòng nhập mật khẩu' }]}>
              <Input.Password prefix={<LockOutlined />} placeholder="Nhập mật khẩu Firebase" autoComplete="current-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={isSubmitting} icon={<SafetyCertificateFilled />}>
              Đăng nhập
            </Button>
            <Button type="link" block icon={<GiftOutlined />} onClick={onViewPublicContent}>
              Xem nội dung công khai không cần đăng nhập
            </Button>
          </Form>

          <div className="login-hint-ant">
            <KeyOutlined /> Đăng nhập bằng <Text strong>tungtv</Text> hoặc email
          </div>
        </Card>
      </Content>
      <Footer className="login-footer-ant">Được bảo vệ bởi Firebase Authentication</Footer>
    </Layout>
  )
}

function Dashboard({ user, onLogout }) {
  const { message, modal } = AntApp.useApp()
  const [accounts, setAccounts] = useState([])
  const [newAccount, setNewAccount] = useState('')
  const [newStatus, setNewStatus] = useState(ACCOUNT_STATUSES[0])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [updatingId, setUpdatingId] = useState('')
  const [updatingField, setUpdatingField] = useState('')
  const [deletingId, setDeletingId] = useState('')
  const [dataError, setDataError] = useState('')
  const [activePage, setActivePage] = useState('accounts')

  useEffect(() => {
    const accountsQuery = query(
      collection(db, 'users', user.uid, 'accounts'),
      orderBy('createdAt', 'desc'),
    )

    const loadingTimeout = window.setTimeout(() => {
      setDataError('Firebase phản hồi quá lâu. Hãy kiểm tra kết nối và tải lại trang.')
      setIsLoading(false)
    }, 12000)

    const unsubscribe = onSnapshot(
      accountsQuery,
      (snapshot) => {
        window.clearTimeout(loadingTimeout)
        setAccounts(snapshot.docs.map((accountDoc) => ({
          id: accountDoc.id,
          ...accountDoc.data(),
        })))
        setDataError('')
        setIsLoading(false)
      },
      () => {
        window.clearTimeout(loadingTimeout)
        setDataError('Không thể tải dữ liệu. Hãy kiểm tra Firestore và Security Rules.')
        setIsLoading(false)
      },
    )

    return () => {
      window.clearTimeout(loadingTimeout)
      unsubscribe()
    }
  }, [user.uid])

  const filteredAccounts = useMemo(() => {
    const searchText = search.trim().toLocaleLowerCase('vi')
    return accounts.filter((account) => {
      const matchesStatus = statusFilter === 'all' || account.status === statusFilter
      const searchableText = `${account.name} ${account.status || ''} ${account.note || ''} ${account.trackingCode || ''}`
        .toLocaleLowerCase('vi')
      const matchesSearch = !searchText || searchableText.includes(searchText)
      return matchesStatus && matchesSearch
    })
  }, [accounts, search, statusFilter])

  async function saveAccount(name, status) {
    setIsSaving(true)
    setDataError('')
    try {
      await addDoc(collection(db, 'users', user.uid, 'accounts'), {
        name,
        status,
        note: '',
        trackingCode: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      setNewAccount('')
      message.success('Đã lưu và đồng bộ tài khoản mới')
    } catch {
      setDataError('Không thể lưu bản ghi. Vui lòng thử lại.')
    } finally {
      setIsSaving(false)
    }
  }

  function addAccount() {
    const name = newAccount.trim()
    if (!name || isSaving) return

    const normalizedName = name.replace(/\s+/g, ' ').toLocaleLowerCase('vi')
    const duplicateAccount = accounts.find((account) => String(account.name || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('vi') === normalizedName)

    if (duplicateAccount) {
      modal.confirm({
        title: 'Tài khoản này đã tồn tại',
        content: (
          <div>
            Đã có bản ghi <Text strong>{duplicateAccount.name}</Text> trong danh sách.
            Bạn vẫn muốn lưu thêm một bản ghi giống vậy không?
          </div>
        ),
        okText: 'Vẫn lưu',
        cancelText: 'Hủy',
        centered: true,
        onOk: () => saveAccount(name, newStatus),
      })
      return
    }

    return saveAccount(name, newStatus)
  }

  async function removeAccount(id) {
    setDeletingId(id)
    setDataError('')
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'accounts', id))
      message.success('Đã xóa bản ghi')
    } catch {
      setDataError('Không thể xóa bản ghi. Vui lòng thử lại.')
    } finally {
      setDeletingId('')
    }
  }

  async function updateAccountStatus(id, status) {
    if (!ACCOUNT_STATUSES.includes(status)) return

    setUpdatingId(id)
    setDataError('')
    try {
      await updateDoc(doc(db, 'users', user.uid, 'accounts', id), {
        status,
        updatedAt: serverTimestamp(),
      })
      message.success('Đã cập nhật trạng thái')
    } catch {
      setDataError('Không thể cập nhật trạng thái. Vui lòng thử lại.')
    } finally {
      setUpdatingId('')
    }
  }

  async function updateAccountTextField(id, field, value) {
    const limits = { note: 1000, trackingCode: 100 }
    if (!(field in limits) || value.length > limits[field]) return false

    const updateKey = `${id}:${field}`
    setUpdatingField(updateKey)
    setDataError('')
    try {
      await updateDoc(doc(db, 'users', user.uid, 'accounts', id), {
        [field]: value,
        updatedAt: serverTimestamp(),
      })
      message.success(field === 'note' ? 'Đã lưu ghi chú' : 'Đã lưu mã vận đơn')
      return true
    } catch {
      setDataError(field === 'note'
        ? 'Không thể lưu ghi chú. Vui lòng thử lại.'
        : 'Không thể lưu mã vận đơn. Vui lòng thử lại.')
      return false
    } finally {
      setUpdatingField('')
    }
  }

  const columns = [
    {
      title: '#',
      width: 44,
      align: 'center',
      render: (_value, _record, index) => <Text type="secondary">{String(index + 1).padStart(2, '0')}</Text>,
    },
    {
      title: 'Tài khoản',
      dataIndex: 'name',
      key: 'name',
      width: 190,
      sorter: (left, right) => compareVietnameseText(left.name, right.name),
      sortDirections: ['ascend', 'descend'],
      render: (name) => (
        <Space size={8}>
          <Avatar size={30} className="account-avatar" icon={<UserOutlined />} />
          <div className="account-cell">
            <Text strong>{name}</Text>
            <Text type="secondary"><CloudSyncOutlined /> Đã đồng bộ</Text>
          </div>
        </Space>
      ),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 180,
      sorter: (left, right) => {
        const leftIndex = ACCOUNT_STATUSES.indexOf(left.status)
        const rightIndex = ACCOUNT_STATUSES.indexOf(right.status)
        return (leftIndex < 0 ? ACCOUNT_STATUSES.length : leftIndex)
          - (rightIndex < 0 ? ACCOUNT_STATUSES.length : rightIndex)
      },
      sortDirections: ['ascend', 'descend'],
      render: (status, record) => (
        <Select
          className="table-status-select"
          size="small"
          value={status || ACCOUNT_STATUSES[0]}
          options={STATUS_OPTIONS}
          loading={updatingId === record.id}
          disabled={updatingId === record.id}
          onChange={(value) => updateAccountStatus(record.id, value)}
          aria-label={`Trạng thái của ${record.name}`}
        />
      ),
    },
    {
      title: 'Cập nhật',
      key: 'updatedAt',
      width: 86,
      sorter: (left, right) => getTimestampMilliseconds(left.updatedAt || left.createdAt)
        - getTimestampMilliseconds(right.updatedAt || right.createdAt),
      sortDirections: ['descend', 'ascend'],
      render: (_value, record) => {
        const updatedAt = record.updatedAt || record.createdAt
        return (
          <Tooltip
            placement="top"
            title={(
              <div className="account-time-tooltip">
                <div>Tạo lúc: {formatExactDate(record.createdAt)}</div>
                <div>Đã tạo cách đây: {formatElapsedDetail(record.createdAt)}</div>
                <div>Cập nhật lúc: {formatExactDate(updatedAt)}</div>
                <div>Cập nhật cách đây: {formatElapsedDetail(updatedAt)}</div>
              </div>
            )}
          >
            <Tag className="compact-time-tag" color="success">
              {formatCompactRelative(updatedAt)}
            </Tag>
          </Tooltip>
        )
      },
    },
    {
      title: <Space size={6}><TruckOutlined /> Mã vận đơn</Space>,
      dataIndex: 'trackingCode',
      key: 'trackingCode',
      width: 140,
      render: (trackingCode, record) => (
        <EditableAccountText
          key={`${record.id}:trackingCode:${trackingCode || ''}`}
          value={trackingCode}
          placeholder="Mã vận đơn..."
          maxLength={100}
          loading={updatingField === `${record.id}:trackingCode`}
          onSave={(value) => updateAccountTextField(record.id, 'trackingCode', value)}
        />
      ),
    },
    {
      title: <Space size={6}><FileTextOutlined /> Ghi chú</Space>,
      dataIndex: 'note',
      key: 'note',
      width: 240,
      render: (note, record) => (
        <EditableAccountText
          key={`${record.id}:note:${note || ''}`}
          value={note}
          placeholder="Nhập ghi chú..."
          maxLength={1000}
          multiline
          loading={updatingField === `${record.id}:note`}
          onSave={(value) => updateAccountTextField(record.id, 'note', value)}
        />
      ),
    },
    {
      title: 'Hành động',
      key: 'action',
      width: 88,
      align: 'center',
      render: (_value, record) => {
        const trackingCode = String(record.trackingCode || '').trim()
        return (
          <Space size={0}>
            {trackingCode && (
              <Tooltip title={`Tra cứu ${trackingCode} trên SPX`}>
                <Button
                  type="text"
                  icon={<SearchOutlined />}
                  href={`https://spx.vn/track?${encodeURIComponent(trackingCode)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Tra cứu mã vận đơn ${trackingCode} trên SPX`}
                />
              </Tooltip>
            )}
            <Popconfirm
              title="Xóa tài khoản?"
              description="Bản ghi sẽ bị xóa khỏi Firestore."
              okText="Xóa"
              cancelText="Hủy"
              okButtonProps={{ danger: true }}
              onConfirm={() => removeAccount(record.id)}
            >
              <Button danger type="text" icon={<DeleteOutlined />} loading={deletingId === record.id} aria-label={`Xóa ${record.name}`} />
            </Popconfirm>
          </Space>
        )
      },
    },
  ]

  return (
    <Layout className="app-layout">
      <Header className="app-header">
        <div className="header-inner">
          <div className="brand-ant">
            <div className="brand-icon-ant"><SafetyCertificateFilled /></div>
            <div><Text strong>Account Vault</Text><Text type="secondary">Quản lý tài khoản cá nhân</Text></div>
          </div>
          <Menu
            className="main-nav"
            mode="horizontal"
            selectedKeys={[activePage]}
            onClick={({ key }) => setActivePage(key)}
            items={[
              { key: 'accounts', icon: <UnorderedListOutlined />, label: 'Danh sách tài khoản' },
              { key: 'credentials', icon: <GlobalOutlined />, label: 'Đăng nhập website' },
              { key: 'discounts', icon: <GiftOutlined />, label: 'Mã giảm giá' },
              { key: 'products', icon: <ShoppingOutlined />, label: 'Sản phẩm' },
              { key: 'telegram', icon: <MessageOutlined />, label: 'Lắng nghe mã' },
            ]}
          />
          <Space size={12}>
            <Avatar className="profile-avatar">T</Avatar>
            <div className="profile-text"><Text strong>tungtv</Text><Text type="secondary">Đã đồng bộ Firebase</Text></div>
            <Button icon={<LogoutOutlined />} onClick={onLogout}>Đăng xuất</Button>
          </Space>
        </div>
      </Header>

      <Content className="dashboard-content">
        {activePage === 'accounts' ? <>
        <section className="welcome-section">
          <div>
            <Text className="section-kicker">TRANG TỔNG QUAN</Text>
            <Title level={2}>Xin chào, Tùng 👋</Title>
            <Paragraph type="secondary">Dữ liệu được bảo mật và đồng bộ theo thời gian thực trên mọi thiết bị.</Paragraph>
          </div>
          <Card className="stat-card" variant="borderless">
            <Statistic title="Tài khoản đã lưu" value={accounts.length} prefix={<UserOutlined />} />
          </Card>
        </section>

        <Card className="panel-card" title={<Space><PlusOutlined className="panel-title-icon add" /><span>Thêm tài khoản mới</span></Space>}>
          <Paragraph type="secondary" className="panel-description">Nhập thông tin và chọn trạng thái trước khi lưu vào Firestore.</Paragraph>
          <Form className="account-form" onFinish={addAccount}>
            <Input
              size="large"
              maxLength={300}
              value={newAccount}
              onChange={(event) => setNewAccount(event.target.value)}
              prefix={<UserOutlined />}
              placeholder="Ví dụ: Tài khoản Shopee shop A..."
              aria-label="Thông tin tài khoản mới"
            />
            <Select
              size="large"
              value={newStatus}
              options={STATUS_OPTIONS}
              onChange={setNewStatus}
              aria-label="Trạng thái tài khoản mới"
            />
            <Button size="large" type="primary" htmlType="submit" icon={<PlusOutlined />} loading={isSaving} disabled={!newAccount.trim()}>
              Lưu tài khoản
            </Button>
          </Form>
          {dataError && <Alert className="data-alert" message={dataError} type="error" showIcon closable onClose={() => setDataError('')} />}
        </Card>

        <Card className="panel-card table-card" title={<Space><KeyOutlined className="panel-title-icon list" /><span>Danh sách của bạn</span></Space>} extra={(
          <Space wrap>
            <Select
              className="status-filter-select"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'all', label: <Space size={8}><FilterOutlined /><span>Tất cả trạng thái</span></Space> },
                ...STATUS_OPTIONS,
              ]}
              aria-label="Lọc theo trạng thái"
            />
            <Input
              className="search-input"
              prefix={<SearchOutlined />}
              placeholder="Tìm tên, ghi chú, mã vận đơn..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              allowClear
            />
          </Space>
        )}>
          <Table
            className="accounts-table"
            rowKey="id"
            columns={columns}
            dataSource={filteredAccounts}
            loading={isLoading}
            pagination={false}
            tableLayout="fixed"
            scroll={{ x: 930 }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={search || statusFilter !== 'all' ? 'Không tìm thấy tài khoản phù hợp' : 'Chưa có tài khoản nào'}
                />
              ),
            }}
          />
        </Card>
        </> : activePage === 'credentials'
          ? <CredentialsPage user={user} />
          : activePage === 'discounts'
            ? <DiscountCodesPage user={user} />
            : activePage === 'products'
              ? <ProductsPage user={user} />
              : <TelegramCodesPage />}
      </Content>

      <Footer className="app-footer"><CloudSyncOutlined /> Account Vault · Đồng bộ bằng Firebase Firestore</Footer>
    </Layout>
  )
}

function AuthLoading() {
  return (
    <div className="auth-loading-ant">
      <div className="login-brand-icon"><SafetyCertificateFilled /></div>
      <Spin size="large" />
      <Text type="secondary">Đang kiểm tra phiên đăng nhập...</Text>
    </div>
  )
}

function PublicContent({ activePage, onNavigate, onLogin }) {
  const isProductsPage = activePage === 'products'
  const isTelegramPage = activePage === 'telegram'

  return (
    <Layout className="app-layout">
      <Header className="app-header">
        <div className="header-inner">
          <div className="brand-ant">
            <div className="brand-icon-ant"><SafetyCertificateFilled /></div>
            <div><Text strong>Account Vault</Text><Text type="secondary">Nội dung công khai</Text></div>
          </div>
          <Menu
            className="main-nav public-main-nav"
            mode="horizontal"
            selectedKeys={[activePage]}
            onClick={({ key }) => onNavigate(key)}
            items={[
              { key: 'discounts', icon: <GiftOutlined />, label: 'Mã giảm giá' },
              { key: 'products', icon: <ShoppingOutlined />, label: 'Sản phẩm' },
              { key: 'telegram', icon: <MessageOutlined />, label: 'Lắng nghe mã' },
            ]}
          />
          <Button icon={<UserOutlined />} onClick={onLogin}>Đăng nhập</Button>
        </div>
      </Header>
      <Content className="dashboard-content">
        {isProductsPage
          ? <ProductsPage />
          : isTelegramPage
            ? <TelegramCodesPage />
            : <DiscountCodesPage />}
      </Content>
      <Footer className="app-footer"><CloudSyncOutlined /> Nội dung công khai được đồng bộ bằng Firebase Firestore</Footer>
    </Layout>
  )
}

function VaultApp() {
  const [authState, setAuthState] = useState({ loading: true, user: null })
  const [guestPage, setGuestPage] = useState('discounts')

  useEffect(() => onAuthStateChanged(auth, (user) => {
    setAuthState({ loading: false, user })
  }), [])

  async function login(password) {
    await signInWithEmailAndPassword(auth, FIREBASE_LOGIN_EMAIL, password)
  }

  async function logout() {
    setGuestPage('discounts')
    await signOut(auth)
  }

  if (authState.loading) return <AuthLoading />
  if (authState.user) return <Dashboard user={authState.user} onLogout={logout} />
  return guestPage === 'login'
    ? <Login onLogin={login} onViewPublicContent={() => setGuestPage('discounts')} />
    : <PublicContent activePage={guestPage} onNavigate={setGuestPage} onLogin={() => setGuestPage('login')} />
}

function App() {
  return (
    <ConfigProvider
      locale={viVN}
      theme={{
        token: {
          colorPrimary: '#1677ff',
          colorInfo: '#1677ff',
          colorSuccess: '#52c41a',
          borderRadius: 10,
          borderRadiusLG: 16,
          colorBgLayout: '#f5f7fb',
          colorText: '#17233c',
          fontFamily: "'Inter', 'Segoe UI', sans-serif",
        },
        components: {
          Button: { controlHeightLG: 44, fontWeight: 600 },
          Card: { headerFontSize: 16 },
          Input: { controlHeightLG: 44 },
          Select: { controlHeightLG: 44 },
          Table: { headerBg: '#fafbff', headerColor: '#5f6b7d' },
        },
      }}
    >
      <AntApp>
        <VaultApp />
      </AntApp>
    </ConfigProvider>
  )
}

export default App
