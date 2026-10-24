import { useEffect, useMemo, useState } from 'react'
import {
  App as AntApp,
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  ConfigProvider,
  Descriptions,
  Empty,
  Form,
  Input,
  Image,
  Layout,
  Menu,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd'
import viVN from 'antd/locale/vi_VN'
import {
  ArrowRightOutlined,
  CloudSyncOutlined,
  DeleteOutlined,
  EyeOutlined,
  FileTextOutlined,
  FilterOutlined,
  GiftOutlined,
  KeyOutlined,
  LockOutlined,
  LogoutOutlined,
  PlusOutlined,
  PictureOutlined,
  PushpinFilled,
  PushpinOutlined,
  SafetyCertificateFilled,
  SearchOutlined,
  ShoppingOutlined,
  UnorderedListOutlined,
  UploadOutlined,
  UserOutlined,
  GlobalOutlined,
} from '@ant-design/icons'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { auth, db, FIREBASE_LOGIN_EMAIL } from './firebase'
import CredentialsPage from './CredentialsPage'
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
  'Đang sử dụng Lazada': { color: '#ff7a00' },
  'Đã sử dụng Lazada': { color: '#6f2da8' },
  'Đã khóa mã người mới': { color: '#ad6800' },
  'Đã khóa M02': { color: '#fa8c16' },
  'Đã khóa M04': { color: '#f5222d' },
  'Đã khóa F02': { color: '#722ed1' },
}

const ACCOUNT_STATUSES = Object.keys(STATUS_META)
const MAX_VISIBLE_STATUSES = 2
const MAX_ACCOUNT_IMAGES = 2
const MAX_SOURCE_IMAGE_SIZE = 12 * 1024 * 1024
const MAX_STORED_IMAGE_SIZE = 510000
const MAX_ENCODED_IMAGE_LENGTH = 680000
const MAX_IMAGE_DIMENSION = 1800
const ACCOUNT_IMAGE_SLOTS = ['slot1', 'slot2']
const ACCOUNT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const ACCOUNT_IMAGE_SOURCE_TYPES = [...ACCOUNT_IMAGE_TYPES, 'image/heic', 'image/heif']
const ACCOUNT_IMAGE_EXTENSION_TYPES = {
  heic: 'image/heic',
  heif: 'image/heif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}
const STATUS_OPTIONS = ACCOUNT_STATUSES.map((status) => ({
  value: status,
  label: (
    <Space size={8}>
      <Badge color={STATUS_META[status].color} />
      <span>{status}</span>
    </Space>
  ),
}))

function normalizeAccountStatuses(status) {
  const statuses = Array.isArray(status) ? status : [status]
  return [...new Set(statuses.filter((value) => ACCOUNT_STATUSES.includes(value)))]
}

function getAccountStatuses(status) {
  const statuses = normalizeAccountStatuses(status)
  return statuses.length > 0 ? statuses : [ACCOUNT_STATUSES[0]]
}

function isValidAccountStatuses(statuses) {
  return Array.isArray(statuses)
    && statuses.length > 0
    && statuses.length <= ACCOUNT_STATUSES.length
    && normalizeAccountStatuses(statuses).length === statuses.length
}

function renderOmittedStatuses(omittedValues) {
  const omittedStatuses = omittedValues.map(({ value }) => value).join(', ')
  return (
    <Tooltip title={omittedStatuses}>
      <span className="status-overflow-count">+{omittedValues.length}</span>
    </Tooltip>
  )
}

function renderStatusTag(selectedStatuses, showOverflowOnSecondLine = false) {
  const selectedCount = selectedStatuses.length
  const omittedStatuses = selectedStatuses.slice(MAX_VISIBLE_STATUSES)

  return ({ value, label, isMaxTag }) => {
    if (isMaxTag) return label

    const selectedIndex = selectedStatuses.indexOf(value)
    const statusContent = (
      <>
        <Badge color={STATUS_META[value]?.color || '#8c8c8c'} />
        <span className="status-selection-label">{value}</span>
        {showOverflowOnSecondLine && selectedIndex === 1 && omittedStatuses.length > 0 && (
          <Tooltip title={omittedStatuses.join(', ')}>
            <span className="status-overflow-count">+{omittedStatuses.length}</span>
          </Tooltip>
        )}
      </>
    )

    if (selectedCount === 1) {
      return <span className="single-status-selection">{statusContent}</span>
    }

    return <span className="multiple-status-selection">{statusContent}</span>
  }
}

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
  if (days < 30) return `${Math.floor(days / 7)}w`

  return `${Math.floor(days / 30)}m`
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

function getAccountImageSlots(slots) {
  if (!Array.isArray(slots)) return []
  return [...new Set(slots.filter((slot) => ACCOUNT_IMAGE_SLOTS.includes(slot)))]
    .slice(0, MAX_ACCOUNT_IMAGES)
}

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('READ_IMAGE_FAILED'))
    reader.readAsDataURL(blob)
  })
}

function getAccountImageContentType(file) {
  const reportedType = String(file?.type || '').toLocaleLowerCase('en').split(';')[0]
  const normalizedType = reportedType === 'image/jpg' ? 'image/jpeg' : reportedType
  if (ACCOUNT_IMAGE_SOURCE_TYPES.includes(normalizedType)) return normalizedType

  const extension = String(file?.name || '').split('.').pop()?.toLocaleLowerCase('en') || ''
  return ACCOUNT_IMAGE_EXTENSION_TYPES[extension] || ''
}

function canvasToBlob(canvas, contentType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('COMPRESS_IMAGE_FAILED'))),
      contentType,
      quality,
    )
  })
}

function loadImageElement(blob) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob)
    const image = new window.Image()

    image.onload = () => resolve({
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(objectUrl),
    })
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('DECODE_IMAGE_FAILED'))
    }
    image.src = objectUrl
  })
}

async function encodeCanvasImage(canvas, quality) {
  try {
    const webpBlob = await canvasToBlob(canvas, 'image/webp', quality)
    if (webpBlob.type === 'image/webp') return webpBlob
  } catch {
    // Older Safari versions may not encode WebP; JPEG is the compatible fallback.
  }

  try {
    const jpegBlob = await canvasToBlob(canvas, 'image/jpeg', quality)
    if (jpegBlob.type === 'image/jpeg') return jpegBlob
    if (ACCOUNT_IMAGE_TYPES.includes(jpegBlob.type)) return jpegBlob
  } catch {
    // Converted to the stable error code below for a useful message on iOS.
  }

  throw new Error('COMPRESS_IMAGE_FAILED')
}

async function prepareAccountImage(file, sourceContentType) {
  const normalizedBlob = file.type === sourceContentType
    ? file
    : file.slice(0, file.size, sourceContentType)
  const originalDataUrl = await readBlobAsDataUrl(normalizedBlob)
  if (
    ACCOUNT_IMAGE_TYPES.includes(sourceContentType)
    && file.size <= MAX_STORED_IMAGE_SIZE
    && originalDataUrl.length <= MAX_ENCODED_IMAGE_LENGTH
    && originalDataUrl.startsWith(`data:${sourceContentType};base64,`)
  ) {
    return { dataUrl: originalDataUrl, contentType: sourceContentType, size: file.size }
  }

  const decodedImage = await loadImageElement(normalizedBlob)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context || !decodedImage.width || !decodedImage.height) {
    decodedImage.release()
    throw new Error('DECODE_IMAGE_FAILED')
  }

  let scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(decodedImage.width, decodedImage.height))
  let quality = 0.86

  try {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      canvas.width = Math.max(1, Math.round(decodedImage.width * scale))
      canvas.height = Math.max(1, Math.round(decodedImage.height * scale))
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(decodedImage.source, 0, 0, canvas.width, canvas.height)

      const blob = await encodeCanvasImage(canvas, quality)
      const dataUrl = await readBlobAsDataUrl(blob)
      if (
        ACCOUNT_IMAGE_TYPES.includes(blob.type)
        && blob.size <= MAX_STORED_IMAGE_SIZE
        && dataUrl.length <= MAX_ENCODED_IMAGE_LENGTH
        && dataUrl.startsWith(`data:${blob.type};base64,`)
      ) {
        return { dataUrl, contentType: blob.type, size: blob.size }
      }

      if (quality > 0.5) quality -= 0.1
      else {
        scale *= 0.8
        quality = 0.76
      }
    }
  } finally {
    decodedImage.release()
  }

  throw new Error('IMAGE_TOO_LARGE_AFTER_COMPRESSION')
}

function EditableAccountText({
  value,
  placeholder,
  maxLength,
  loading,
  multiline = false,
  collapsedWhenEmpty = false,
  onSave,
}) {
  const [draft, setDraft] = useState(value || '')
  const [isEditing, setIsEditing] = useState(!collapsedWhenEmpty || Boolean(value))

  async function saveDraft() {
    const normalizedValue = draft.trim()
    if (normalizedValue === (value || '')) {
      if (collapsedWhenEmpty && !normalizedValue) setIsEditing(false)
      return
    }

    const saved = await onSave(normalizedValue)
    if (!saved) {
      setDraft(value || '')
      if (collapsedWhenEmpty && !value) setIsEditing(false)
    }
  }

  if (collapsedWhenEmpty && !value && !isEditing) {
    return (
      <Button
        className="empty-field-add-button"
        type="dashed"
        size="small"
        icon={<PlusOutlined />}
        disabled={loading}
        onClick={() => setIsEditing(true)}
        aria-label={`Thêm ${placeholder.toLocaleLowerCase('vi')}`}
      />
    )
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
      autoFocus={collapsedWhenEmpty && isEditing}
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
        <div className="login-shell">
          <Card className="login-card" variant="borderless">
            <div className="login-brand-icon"><SafetyCertificateFilled /></div>
            <Text className="login-eyebrow">KHÔNG GIAN CÁ NHÂN</Text>
            <Title level={2}>Chào mừng trở lại</Title>
            <Paragraph type="secondary">Đăng nhập để quản lý và đồng bộ tài khoản của bạn.</Paragraph>

            {error && <Alert className="login-alert" message={error} type="error" showIcon closable onClose={() => setError('')} />}

            <Form layout="vertical" requiredMark={false} onFinish={handleSubmit} size="large">
              <Form.Item label="Tên đăng nhập" name="username" rules={[{ required: true, message: 'Vui lòng nhập tên đăng nhập' }]}>
                <Input prefix={<UserOutlined />} placeholder="Tên đăng nhập hoặc email" autoComplete="username" autoFocus />
              </Form.Item>
              <Form.Item label="Mật khẩu" name="password" rules={[{ required: true, message: 'Vui lòng nhập mật khẩu' }]}>
                <Input.Password prefix={<LockOutlined />} placeholder="Nhập mật khẩu" autoComplete="current-password" />
              </Form.Item>
              <Button type="primary" htmlType="submit" block loading={isSubmitting} icon={<SafetyCertificateFilled />}>
                Đăng nhập
              </Button>
            </Form>

            <div className="login-hint-ant">
              <LockOutlined /> Khu vực dành cho tài khoản được cấp quyền
            </div>
          </Card>

          <section className="public-features" aria-labelledby="public-features-title">
            <div className="public-features-heading">
              <Text className="login-eyebrow">KHÁM PHÁ MIỄN PHÍ</Text>
              <Title id="public-features-title" level={4}>Dùng ngay, không cần đăng nhập</Title>
            </div>
            <div className="public-feature-grid">
              <button className="public-feature-card vouchers" type="button" onClick={() => onViewPublicContent('telegram')}>
                <span className="public-feature-icon"><GiftOutlined /></span>
                <span className="public-feature-copy">
                  <Text strong>Mã giảm giá</Text>
                  <Text type="secondary">Xem mã ưu đãi được cập nhật tự động mỗi giờ.</Text>
                </span>
                <ArrowRightOutlined className="public-feature-arrow" />
              </button>
              <button className="public-feature-card products" type="button" onClick={() => onViewPublicContent('products')}>
                <span className="public-feature-icon"><ShoppingOutlined /></span>
                <span className="public-feature-copy">
                  <Text strong>Sản phẩm</Text>
                  <Text type="secondary">Khám phá sản phẩm và mở liên kết mua sắm.</Text>
                </span>
                <ArrowRightOutlined className="public-feature-arrow" />
              </button>
            </div>
          </section>
        </div>
      </Content>
      <Footer className="login-footer-ant">Được bảo vệ bởi Firebase Authentication</Footer>
    </Layout>
  )
}

function Dashboard({ user, onLogout }) {
  const { message, modal } = AntApp.useApp()
  const [accounts, setAccounts] = useState([])
  const [newAccount, setNewAccount] = useState('')
  const [newStatus, setNewStatus] = useState([ACCOUNT_STATUSES[0]])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [accountSort, setAccountSort] = useState({ field: '', order: null })
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [updatingId, setUpdatingId] = useState('')
  const [updatingField, setUpdatingField] = useState('')
  const [deletingId, setDeletingId] = useState('')
  const [pinningId, setPinningId] = useState('')
  const [uploadingAccountId, setUploadingAccountId] = useState('')
  const [deletingImageId, setDeletingImageId] = useState('')
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [accountImages, setAccountImages] = useState([])
  const [areImagesLoading, setAreImagesLoading] = useState(false)
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

  useEffect(() => {
    if (!selectedAccountId) return undefined

    const imagesQuery = query(
      collection(db, 'users', user.uid, 'accounts', selectedAccountId, 'images'),
      orderBy('createdAt', 'asc'),
    )
    return onSnapshot(
      imagesQuery,
      (snapshot) => {
        setAccountImages(snapshot.docs.map((imageDoc) => ({
          id: imageDoc.id,
          ...imageDoc.data(),
        })))
        setAreImagesLoading(false)
      },
      () => {
        setAccountImages([])
        setAreImagesLoading(false)
        setDataError('Không thể tải hình ảnh từ Firestore. Vui lòng thử lại.')
      },
    )
  }, [selectedAccountId, user.uid])

  const filteredAccounts = useMemo(() => {
    const searchText = search.trim().toLocaleLowerCase('vi')
    return accounts.filter((account) => {
      const accountStatuses = getAccountStatuses(account.status)
      const matchesStatus = statusFilter === 'all' || accountStatuses.includes(statusFilter)
      const searchableText = `${account.name} ${accountStatuses.join(' ')} ${account.note || ''}`
        .toLocaleLowerCase('vi')
      const matchesSearch = !searchText || searchableText.includes(searchText)
      return matchesStatus && matchesSearch
    })
  }, [accounts, search, statusFilter])

  const displayedAccounts = useMemo(() => [...filteredAccounts].sort((left, right) => {
    const pinnedComparison = Number(Boolean(right.isPinned)) - Number(Boolean(left.isPinned))
    if (pinnedComparison !== 0) return pinnedComparison
    if (!accountSort.order) return 0

    let comparison = 0
    if (accountSort.field === 'name') {
      comparison = compareVietnameseText(left.name, right.name)
    } else if (accountSort.field === 'status') {
      const leftIndex = ACCOUNT_STATUSES.indexOf(getAccountStatuses(left.status)[0])
      const rightIndex = ACCOUNT_STATUSES.indexOf(getAccountStatuses(right.status)[0])
      comparison = (leftIndex < 0 ? ACCOUNT_STATUSES.length : leftIndex)
        - (rightIndex < 0 ? ACCOUNT_STATUSES.length : rightIndex)
    } else if (accountSort.field === 'updatedAt') {
      comparison = getTimestampMilliseconds(left.updatedAt || left.createdAt)
        - getTimestampMilliseconds(right.updatedAt || right.createdAt)
    }

    return accountSort.order === 'descend' ? -comparison : comparison
  }), [accountSort, filteredAccounts])

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) || null,
    [accounts, selectedAccountId],
  )

  function openAccountDetails(accountId) {
    setAccountImages([])
    setAreImagesLoading(true)
    setSelectedAccountId(accountId)
  }

  function closeAccountDetails() {
    setSelectedAccountId('')
    setAccountImages([])
    setAreImagesLoading(false)
  }

  async function saveAccount(name, status) {
    if (!isValidAccountStatuses(status)) return

    setIsSaving(true)
    setDataError('')
    try {
      await addDoc(collection(db, 'users', user.uid, 'accounts'), {
        name,
        status: normalizeAccountStatuses(status),
        note: '',
        trackingCode: '',
        imageSlots: [],
        isPinned: false,
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

  async function removeAccount(account) {
    setDeletingId(account.id)
    setDataError('')
    try {
      const accountReference = doc(db, 'users', user.uid, 'accounts', account.id)
      const imageDocuments = await getDocs(collection(accountReference, 'images'))
      const batch = writeBatch(db)
      imageDocuments.forEach((imageDocument) => batch.delete(imageDocument.ref))
      batch.delete(accountReference)
      await batch.commit()
      if (selectedAccountId === account.id) closeAccountDetails()
      message.success('Đã xóa bản ghi')
    } catch {
      setDataError('Không thể xóa bản ghi. Vui lòng thử lại.')
    } finally {
      setDeletingId('')
    }
  }

  async function uploadAccountImage(account, file) {
    const sourceContentType = getAccountImageContentType(file)
    if (!sourceContentType) {
      message.error('Chỉ hỗ trợ ảnh JPG, PNG, WEBP, HEIC hoặc HEIF.')
      return
    }
    if (!file.size || file.size > MAX_SOURCE_IMAGE_SIZE) {
      message.error('Ảnh gốc phải nhỏ hơn hoặc bằng 12 MB.')
      return
    }
    if (getAccountImageSlots(account.imageSlots).length >= MAX_ACCOUNT_IMAGES) {
      message.warning('Mỗi tài khoản chỉ được lưu tối đa 2 ảnh.')
      return
    }

    const accountReference = doc(db, 'users', user.uid, 'accounts', account.id)

    setUploadingAccountId(account.id)
    setDataError('')
    try {
      const preparedImage = await prepareAccountImage(file, sourceContentType)
      await runTransaction(db, async (transaction) => {
        const accountSnapshot = await transaction.get(accountReference)
        if (!accountSnapshot.exists()) throw new Error('ACCOUNT_NOT_FOUND')

        const slotReferences = ACCOUNT_IMAGE_SLOTS.map((slot) => (
          doc(accountReference, 'images', slot)
        ))
        const slotSnapshots = []
        for (const slotReference of slotReferences) {
          slotSnapshots.push(await transaction.get(slotReference))
        }
        const occupiedSlots = slotSnapshots
          .filter((snapshot) => snapshot.exists())
          .map((snapshot) => snapshot.id)
        const availableSlot = ACCOUNT_IMAGE_SLOTS.find((slot) => !occupiedSlots.includes(slot))
        if (!availableSlot) throw new Error('MAX_IMAGES')

        transaction.set(doc(accountReference, 'images', availableSlot), {
          dataUrl: preparedImage.dataUrl,
          fileName: String(file.name || `anh-${Date.now()}.webp`).slice(0, 255),
          contentType: preparedImage.contentType,
          size: preparedImage.size,
          createdAt: serverTimestamp(),
        })
        transaction.update(accountReference, {
          imageSlots: [...occupiedSlots, availableSlot],
          updatedAt: serverTimestamp(),
        })
      })
      message.success('Đã nén và lưu ảnh vào Firestore')
    } catch (error) {
      if (error?.message === 'MAX_IMAGES') {
        message.warning('Tài khoản vừa đạt giới hạn 2 ảnh.')
      } else if (error?.message === 'DECODE_IMAGE_FAILED') {
        setDataError('Safari không đọc được ảnh này. Hãy thử lưu ảnh vào Tệp hoặc chuyển sang JPG/PNG rồi tải lại.')
      } else if (error?.message === 'IMAGE_TOO_LARGE_AFTER_COMPRESSION') {
        setDataError('Không thể nén ảnh xuống dung lượng lưu trữ. Hãy cắt ảnh nhỏ hơn rồi thử lại.')
      } else if (error?.message === 'COMPRESS_IMAGE_FAILED') {
        setDataError('Trình duyệt không thể nén ảnh. Hãy thử cập nhật iOS hoặc chuyển ảnh sang JPG/PNG.')
      } else if (error?.message === 'READ_IMAGE_FAILED') {
        setDataError('Không thể đọc dữ liệu ảnh từ thiết bị. Hãy lưu ảnh vào Tệp rồi chọn lại.')
      } else if (String(error?.code || '').includes('permission-denied')) {
        setDataError('Không có quyền lưu ảnh vào Firestore. Vui lòng đăng nhập lại rồi thử lại.')
      } else {
        setDataError('Không thể lưu ảnh vào Firestore. Vui lòng kiểm tra kết nối rồi thử lại.')
      }
    } finally {
      setUploadingAccountId('')
    }
  }

  async function removeAccountImage(account, image) {
    const accountReference = doc(db, 'users', user.uid, 'accounts', account.id)
    setDeletingImageId(image.id)
    setDataError('')
    try {
      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(accountReference)
        if (!snapshot.exists()) throw new Error('ACCOUNT_NOT_FOUND')

        transaction.delete(doc(accountReference, 'images', image.id))
        transaction.update(accountReference, {
          imageSlots: getAccountImageSlots(snapshot.data().imageSlots)
            .filter((slot) => slot !== image.id),
          updatedAt: serverTimestamp(),
        })
      })
      message.success('Đã xóa ảnh')
    } catch {
      setDataError('Không thể xóa ảnh. Vui lòng thử lại.')
    } finally {
      setDeletingImageId('')
    }
  }

  async function toggleAccountPin(account) {
    const nextPinned = !account.isPinned
    setPinningId(account.id)
    setDataError('')
    try {
      await updateDoc(doc(db, 'users', user.uid, 'accounts', account.id), {
        isPinned: nextPinned,
        updatedAt: serverTimestamp(),
      })
      message.success(nextPinned ? 'Đã ghim tài khoản lên đầu' : 'Đã bỏ ghim tài khoản')
    } catch {
      setDataError('Không thể cập nhật trạng thái ghim. Vui lòng thử lại.')
    } finally {
      setPinningId('')
    }
  }

  function handleAccountTableChange(_pagination, _filters, sorter) {
    const activeSorter = Array.isArray(sorter) ? sorter[0] : sorter
    setAccountSort(activeSorter?.order
      ? { field: activeSorter.field || activeSorter.columnKey, order: activeSorter.order }
      : { field: '', order: null })
  }

  async function updateAccountStatus(id, statuses) {
    if (!isValidAccountStatuses(statuses)) return

    setUpdatingId(id)
    setDataError('')
    try {
      await updateDoc(doc(db, 'users', user.uid, 'accounts', id), {
        status: normalizeAccountStatuses(statuses),
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
      width: 150,
      sorter: true,
      sortOrder: accountSort.field === 'name' ? accountSort.order : null,
      sortDirections: ['ascend', 'descend'],
      render: (name) => (
        <Space size={8}>
          <Avatar size={30} className="account-avatar" icon={<UserOutlined />} />
          <div className="account-cell">
            <Tooltip title={name} placement="top" mouseEnterDelay={0.15}>
              <Text strong>{name}</Text>
            </Tooltip>
            <Text type="secondary"><CloudSyncOutlined /> Đã đồng bộ</Text>
          </div>
        </Space>
      ),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 205,
      sorter: true,
      sortOrder: accountSort.field === 'status' ? accountSort.order : null,
      sortDirections: ['ascend', 'descend'],
      render: (status, record) => {
        const selectedStatuses = getAccountStatuses(status)
        return (
          <Select
            className={`table-status-select ${selectedStatuses.length === 1 ? 'has-single-status' : 'has-multiple-statuses'}`}
            mode="multiple"
            value={selectedStatuses}
            options={STATUS_OPTIONS}
            tagRender={renderStatusTag(selectedStatuses, true)}
            maxTagCount={MAX_VISIBLE_STATUSES}
            maxTagPlaceholder={() => null}
            popupMatchSelectWidth
            showSearch={false}
            loading={updatingId === record.id}
            disabled={updatingId === record.id}
            onChange={(value) => updateAccountStatus(record.id, value)}
            aria-label={`Trạng thái của ${record.name}`}
          />
        )
      },
    },
    {
      title: 'Cập nhật',
      key: 'updatedAt',
      width: 86,
      sorter: true,
      sortOrder: accountSort.field === 'updatedAt' ? accountSort.order : null,
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
      width: 180,
      align: 'center',
      render: (_value, record) => {
        const trackingCode = String(record.trackingCode || '').trim()
        const imageSlots = getAccountImageSlots(record.imageSlots)
        const reachedImageLimit = imageSlots.length >= MAX_ACCOUNT_IMAGES
        return (
          <Space size={2}>
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
            {imageSlots.length > 0 && (
              <Tooltip title={`Xem thông tin và ${imageSlots.length} ảnh`}>
                <Button
                  type="text"
                  icon={<EyeOutlined />}
                  onClick={() => openAccountDetails(record.id)}
                  aria-label={`Xem ảnh và thông tin của ${record.name}`}
                />
              </Tooltip>
            )}
            <Tooltip title={record.isPinned ? 'Bỏ ghim' : 'Ghim lên đầu'}>
              <Button
                className={`pin-action-button ${record.isPinned ? 'is-pinned' : ''}`}
                type="text"
                icon={record.isPinned ? <PushpinFilled /> : <PushpinOutlined />}
                loading={pinningId === record.id}
                onClick={() => toggleAccountPin(record)}
                aria-label={`${record.isPinned ? 'Bỏ ghim' : 'Ghim'} ${record.name}`}
              />
            </Tooltip>
            <Popconfirm
              title="Xóa tài khoản?"
              description="Bản ghi sẽ bị xóa khỏi Firestore."
              okText="Xóa"
              cancelText="Hủy"
              okButtonProps={{ danger: true }}
              onConfirm={() => removeAccount(record)}
            >
              <Button danger type="text" icon={<DeleteOutlined />} loading={deletingId === record.id} aria-label={`Xóa ${record.name}`} />
            </Popconfirm>
            <Upload
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
              showUploadList={false}
              beforeUpload={(file) => {
                void uploadAccountImage(record, file)
                return false
              }}
              disabled={reachedImageLimit || uploadingAccountId === record.id}
            >
              <Tooltip title={reachedImageLimit ? 'Đã đủ tối đa 2 ảnh' : `Tải ảnh lên (${imageSlots.length}/2)`}>
                <span>
                  <Button
                    type="text"
                    icon={<UploadOutlined />}
                    loading={uploadingAccountId === record.id}
                    disabled={reachedImageLimit}
                    aria-label={`Tải ảnh lên cho ${record.name}`}
                  />
                </span>
              </Tooltip>
            </Upload>
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
              { key: 'products', icon: <ShoppingOutlined />, label: 'Sản phẩm' },
              { key: 'telegram', icon: <GiftOutlined />, label: 'Mã giảm giá' },
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
              mode="multiple"
              value={newStatus}
              options={STATUS_OPTIONS}
              tagRender={renderStatusTag(newStatus)}
              maxTagCount={MAX_VISIBLE_STATUSES}
              maxTagPlaceholder={renderOmittedStatuses}
              popupMatchSelectWidth={320}
              showSearch={false}
              onChange={(statuses) => {
                if (statuses.length > 0) setNewStatus(statuses)
              }}
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
              placeholder="Tìm tên hoặc ghi chú..."
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
            dataSource={displayedAccounts}
            loading={isLoading}
            pagination={false}
            tableLayout="fixed"
            scroll={{ x: 890 }}
            rowClassName={(record) => (record.isPinned ? 'pinned-account-row' : '')}
            onChange={handleAccountTableChange}
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
          : activePage === 'products'
            ? <ProductsPage user={user} />
            : <TelegramCodesPage user={user} />}

        <Modal
          className="account-images-modal"
          title={<Space><PictureOutlined />Thông tin tài khoản và hình ảnh</Space>}
          open={Boolean(selectedAccount)}
          width={780}
          footer={<Button onClick={closeAccountDetails}>Đóng</Button>}
          onCancel={closeAccountDetails}
        >
          {selectedAccount && (
            <>
              <Descriptions
                className="account-details"
                bordered
                size="small"
                column={{ xs: 1, sm: 2 }}
                items={[
                  { key: 'name', label: 'Tài khoản', children: selectedAccount.name, span: 2 },
                  {
                    key: 'status',
                    label: 'Trạng thái',
                    children: (
                      <Space size={[4, 4]} wrap>
                        {getAccountStatuses(selectedAccount.status).map((status) => (
                          <Tag key={status} color={STATUS_META[status]?.color}>{status}</Tag>
                        ))}
                      </Space>
                    ),
                    span: 2,
                  },
                  { key: 'createdAt', label: 'Ngày tạo', children: formatExactDate(selectedAccount.createdAt) },
                  { key: 'updatedAt', label: 'Cập nhật', children: formatExactDate(selectedAccount.updatedAt || selectedAccount.createdAt) },
                  { key: 'trackingCode', label: 'Mã vận đơn', children: selectedAccount.trackingCode || 'Không có' },
                  { key: 'isPinned', label: 'Ghim', children: selectedAccount.isPinned ? 'Đang ghim' : 'Không ghim' },
                  { key: 'note', label: 'Ghi chú', children: selectedAccount.note || 'Không có', span: 2 },
                ]}
              />

              <div className="account-images-heading">
                <Text strong>Hình ảnh ({accountImages.length}/2)</Text>
                <Text type="secondary">Ảnh được nén và lưu riêng trong Firestore</Text>
              </div>
              {areImagesLoading ? (
                <div className="account-images-loading"><Spin /><Text type="secondary">Đang tải ảnh...</Text></div>
              ) : accountImages.length > 0 ? (
                <div className="account-images-grid">
                  {accountImages.map((image) => (
                    <div className="account-image-card" key={image.id}>
                      <Image src={image.dataUrl} alt={image.fileName} />
                      <div className="account-image-meta">
                        <Tooltip title={image.fileName}>
                          <Text ellipsis>{image.fileName}</Text>
                        </Tooltip>
                        <Popconfirm
                          title="Xóa ảnh này?"
                          description="Ảnh Base64 sẽ bị xóa khỏi Firestore."
                          okText="Xóa"
                          cancelText="Hủy"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => removeAccountImage(selectedAccount, image)}
                        >
                          <Button
                            danger
                            type="text"
                            size="small"
                            icon={<DeleteOutlined />}
                            loading={deletingImageId === image.id}
                          >
                            Xóa ảnh
                          </Button>
                        </Popconfirm>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Tài khoản chưa có ảnh" />
              )}
            </>
          )}
        </Modal>
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
              { key: 'products', icon: <ShoppingOutlined />, label: 'Sản phẩm' },
              { key: 'telegram', icon: <GiftOutlined />, label: 'Mã giảm giá' },
            ]}
          />
          <Button icon={<UserOutlined />} onClick={onLogin}>Đăng nhập</Button>
        </div>
      </Header>
      <Content className="dashboard-content">
        {isProductsPage ? <ProductsPage /> : <TelegramCodesPage />}
      </Content>
      <Footer className="app-footer"><CloudSyncOutlined /> Nội dung công khai được đồng bộ bằng Firebase Firestore</Footer>
    </Layout>
  )
}

function VaultApp() {
  const [authState, setAuthState] = useState({ loading: true, user: null })
  const [guestPage, setGuestPage] = useState('telegram')

  useEffect(() => onAuthStateChanged(auth, (user) => {
    setAuthState({ loading: false, user })
  }), [])

  async function login(password) {
    await signInWithEmailAndPassword(auth, FIREBASE_LOGIN_EMAIL, password)
  }

  async function logout() {
    setGuestPage('telegram')
    await signOut(auth)
  }

  if (authState.loading) return <AuthLoading />
  if (authState.user) return <Dashboard user={authState.user} onLogout={logout} />
  return guestPage === 'login'
    ? <Login onLogin={login} onViewPublicContent={setGuestPage} />
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
