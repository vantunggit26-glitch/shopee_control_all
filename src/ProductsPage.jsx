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
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd'
import {
  CopyOutlined,
  DeleteOutlined,
  FileTextOutlined,
  LinkOutlined,
  PlusOutlined,
  SearchOutlined,
  ShoppingOutlined,
  StarFilled,
} from '@ant-design/icons'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { db, FIREBASE_LOGIN_EMAIL } from './firebase'

const { Title, Text, Paragraph } = Typography
const PRODUCT_API_URL = 'https://data.addlivetag.com/product-data/product-data.php'

function formatPrice(value) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0)
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

function isShopeeUrl(value) {
  try {
    const url = new URL(value)
    const isShopeeDomain = url.hostname === 'shopee.vn'
      || url.hostname.endsWith('.shopee.vn')
      || url.hostname === 'shp.ee'
      || url.hostname.endsWith('.shp.ee')

    return url.protocol === 'https:'
      && isShopeeDomain
  } catch {
    return false
  }
}

function textValue(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function numericValue(value, { integer = false, min = 0, max = 1_000_000_000_000 } = {}) {
  const parsedValue = Number(value)
  if (!Number.isFinite(parsedValue)) return min

  const boundedValue = Math.min(max, Math.max(min, parsedValue))
  return integer ? Math.trunc(boundedValue) : boundedValue
}

function normalizeProduct(productInfo, submittedUrl) {
  const itemId = numericValue(productInfo.itemId, { integer: true, min: 1 })
  const shopId = numericValue(productInfo.shopId, { integer: true, min: 1 })
  const productLink = textValue(productInfo.productLink || productInfo.originLink || submittedUrl, 2048)
  const imageUrl = textValue(productInfo.imageUrl, 2048)
  const price = numericValue(productInfo.price)

  if (!itemId || !shopId || !textValue(productInfo.productName, 500) || !isShopeeUrl(productLink)) {
    throw new Error('API không trả về đủ thông tin sản phẩm Shopee hợp lệ.')
  }

  return {
    itemId,
    shopId,
    productName: textValue(productInfo.productName, 500),
    shopName: textValue(productInfo.shopName, 200) || 'Không rõ cửa hàng',
    productLink,
    imageUrl: imageUrl.startsWith('https://') ? imageUrl : '',
    category: Array.isArray(productInfo.catPath)
      ? textValue(productInfo.catPath.join(' › '), 300)
      : '',
    price,
    minPrice: numericValue(productInfo.priceStats?.minPrice ?? price),
    maxPrice: numericValue(productInfo.priceStats?.maxPrice ?? price),
    sales: numericValue(productInfo.sales, { integer: true }),
    rating: numericValue(productInfo.rating, { max: 5 }),
    commission: numericValue(productInfo.commission),
    totalRatePercent: numericValue(productInfo.totalRatePercent, { max: 100 }),
    isXtra: Boolean(productInfo.isXtra),
    sourceUpdatedAt: textValue(productInfo.lastUpdate, 50),
  }
}

function ProductNoteCell({ value, canManage, loading, onSave }) {
  const [draft, setDraft] = useState(value || '')

  async function saveDraft() {
    const normalizedValue = draft.trim()
    if (normalizedValue === (value || '')) return

    const saved = await onSave(normalizedValue)
    if (!saved) setDraft(value || '')
  }

  if (!canManage) {
    return <Text className="product-note-readonly" type={value ? undefined : 'secondary'}>{value || '—'}</Text>
  }

  return (
    <Input.TextArea
      className="product-note-input"
      value={draft}
      placeholder="Nhập ghi chú..."
      maxLength={1000}
      disabled={loading}
      autoSize={{ minRows: 2, maxRows: 2 }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={saveDraft}
      aria-label="Ghi chú sản phẩm"
    />
  )
}

async function fetchProduct(productUrl) {
  const response = await fetch(`${PRODUCT_API_URL}?url=${encodeURIComponent(productUrl)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })

  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error('API sản phẩm trả về dữ liệu không hợp lệ.')
  }

  if (!response.ok || payload.status !== 'success' || !payload.productInfo) {
    const apiMessage = payload.message || payload.error || payload.apiKeyNotice?.message
    throw new Error(apiMessage || `API sản phẩm phản hồi lỗi ${response.status}.`)
  }

  return payload
}

export default function ProductsPage({ user = null }) {
  const { message } = AntApp.useApp()
  const [form] = Form.useForm()
  const [products, setProducts] = useState([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [updatingNoteId, setUpdatingNoteId] = useState('')
  const canManage = user?.email === FIREBASE_LOGIN_EMAIL

  useEffect(() => {
    const productsQuery = query(
      collection(db, 'products'),
      orderBy('updatedAt', 'desc'),
    )

    const unsubscribe = onSnapshot(
      productsQuery,
      (snapshot) => {
        setProducts(snapshot.docs.map((productDoc) => ({
          id: productDoc.id,
          ...productDoc.data(),
        })))
        setError('')
        setIsLoading(false)
      },
      () => {
        setError('Không thể tải sản phẩm. Firestore Rules mới có thể chưa được triển khai.')
        setIsLoading(false)
      },
    )

    return unsubscribe
  }, [])

  const filteredProducts = useMemo(() => {
    const searchText = search.trim().toLocaleLowerCase('vi')
    if (!searchText) return products

    return products.filter((product) => (
      `${product.productName || ''} ${product.shopName || ''} ${product.category || ''} ${product.itemId || ''} ${product.note || ''}`
        .toLocaleLowerCase('vi')
        .includes(searchText)
    ))
  }, [products, search])

  async function saveProduct(values) {
    if (!canManage) return

    const productUrl = values.productUrl.trim()
    setIsSaving(true)
    setError('')

    try {
      const payload = await fetchProduct(productUrl)
      const product = normalizeProduct(payload.productInfo, productUrl)
      const productId = `${product.shopId}_${product.itemId}`
      const productRef = doc(db, 'products', productId)
      const existingProduct = await getDoc(productRef)

      if (existingProduct.exists()) {
        await updateDoc(productRef, {
          ...product,
          updatedAt: serverTimestamp(),
        })
        message.success('Đã làm mới thông tin sản phẩm')
      } else {
        await setDoc(productRef, {
          ...product,
          note: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        message.success('Đã thêm sản phẩm')
      }

      form.resetFields()

      if (payload.apiKeyNotice?.status === 'missing') {
        message.warning('API bên thứ ba đang cảnh báo thiếu API key và có thể ngừng cho phép gọi trực tiếp.')
      }
    } catch (saveError) {
      setError(saveError?.message || 'Không thể lấy và lưu sản phẩm. Vui lòng kiểm tra link rồi thử lại.')
    } finally {
      setIsSaving(false)
    }
  }

  async function removeProduct(id) {
    if (!canManage) return

    setDeletingId(id)
    setError('')
    try {
      await deleteDoc(doc(db, 'products', id))
      message.success('Đã xóa sản phẩm')
    } catch {
      setError('Không thể xóa sản phẩm.')
    } finally {
      setDeletingId('')
    }
  }

  async function copyProductLink(productLink) {
    try {
      await navigator.clipboard.writeText(productLink)
      message.success('Đã sao chép link sản phẩm')
    } catch {
      message.error('Trình duyệt không cho phép sao chép')
    }
  }

  async function updateProductNote(id, note) {
    if (!canManage || note.length > 1000) return false

    setUpdatingNoteId(id)
    setError('')
    try {
      await updateDoc(doc(db, 'products', id), {
        note,
        updatedAt: serverTimestamp(),
      })
      message.success('Đã lưu ghi chú sản phẩm')
      return true
    } catch {
      setError('Không thể lưu ghi chú sản phẩm. Vui lòng thử lại.')
      return false
    } finally {
      setUpdatingNoteId('')
    }
  }

  const columns = [
    {
      title: 'Sản phẩm',
      key: 'product',
      width: 300,
      render: (_value, record) => (
        <div className="product-cell">
          {record.imageUrl ? (
            <img className="product-image" src={record.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <div className="product-image product-image-placeholder"><ShoppingOutlined /></div>
          )}
          <div className="product-main-info">
            <a href={record.productLink} target="_blank" rel="noopener noreferrer">{record.productName}</a>
            <Text type="secondary">{record.shopName}{record.category ? ` · ${record.category}` : ''}</Text>
            <Space size={6} wrap>
              <Tag>#{record.itemId}</Tag>
              {record.isXtra && <Tag color="orange">Xtra</Tag>}
            </Space>
          </div>
        </div>
      ),
    },
    {
      title: 'Giá',
      key: 'price',
      width: 115,
      render: (_value, record) => (
        <div className="product-price-cell">
          <Text strong>{formatPrice(record.price)}</Text>
          {(record.minPrice !== record.maxPrice) && (
            <Text type="secondary">{formatPrice(record.minPrice)} – {formatPrice(record.maxPrice)}</Text>
          )}
        </div>
      ),
    },
    {
      title: 'Đã bán / Đánh giá',
      key: 'performance',
      width: 125,
      render: (_value, record) => (
        <div className="product-price-cell">
          <Text>{new Intl.NumberFormat('vi-VN').format(record.sales || 0)} đã bán</Text>
          <Text type="secondary"><StarFilled className="product-rating-icon" /> {Number(record.rating || 0).toFixed(1)}</Text>
        </div>
      ),
    },
    {
      title: 'Hoa hồng',
      key: 'commission',
      width: 105,
      render: (_value, record) => (
        <div className="product-price-cell">
          <Text strong>{formatPrice(record.commission)}</Text>
          <Text type="secondary">{record.totalRatePercent || 0}%</Text>
        </div>
      ),
    },
    {
      title: <Space size={6}><FileTextOutlined /> Ghi chú</Space>,
      dataIndex: 'note',
      key: 'note',
      width: 210,
      render: (note, record) => (
        <ProductNoteCell
          key={`${record.id}:note:${note || ''}`}
          value={note}
          canManage={canManage}
          loading={updatingNoteId === record.id}
          onSave={(value) => updateProductNote(record.id, value)}
        />
      ),
    },
    {
      title: 'Cập nhật',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 135,
      render: formatCreatedAt,
    },
    {
      title: '',
      key: 'action',
      width: canManage ? 84 : 48,
      align: 'right',
      render: (_value, record) => (
        <Space size={0}>
          <Button type="text" icon={<CopyOutlined />} onClick={() => copyProductLink(record.productLink)} aria-label={`Sao chép link ${record.productName}`} />
          {canManage && (
            <Popconfirm title="Xóa sản phẩm này?" okText="Xóa" cancelText="Hủy" okButtonProps={{ danger: true }} onConfirm={() => removeProduct(record.id)}>
              <Button danger type="text" icon={<DeleteOutlined />} loading={deletingId === record.id} aria-label={`Xóa ${record.productName}`} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  return (
    <>
      <section className="welcome-section products-welcome">
        <div>
          <Text className="section-kicker">KHO SẢN PHẨM CÔNG KHAI</Text>
          <Title level={2}>Sản phẩm Shopee</Title>
          <Paragraph type="secondary">Xem giá, cửa hàng và thông tin sản phẩm không cần đăng nhập.</Paragraph>
        </div>
        <Card className="stat-card" variant="borderless">
          <Statistic title="Sản phẩm đang có" value={products.length} prefix={<ShoppingOutlined />} />
        </Card>
      </section>

      {canManage && (
        <Card className="panel-card" title={<Space><PlusOutlined className="panel-title-icon add" /><span>Thêm hoặc làm mới sản phẩm</span></Space>}>
          <Form form={form} layout="vertical" requiredMark={false} onFinish={saveProduct}>
            <div className="product-form-grid">
              <Form.Item
                label="Link sản phẩm Shopee"
                name="productUrl"
                rules={[
                  { required: true, whitespace: true, message: 'Nhập link sản phẩm Shopee' },
                  { max: 2048, message: 'Link tối đa 2048 ký tự' },
                  { validator: (_rule, value) => (!value || isShopeeUrl(value.trim()) ? Promise.resolve() : Promise.reject(new Error('Link phải thuộc tên miền shopee.vn hoặc shp.ee'))) },
                ]}
              >
                <Input size="large" prefix={<LinkOutlined />} placeholder="https://shopee.vn/... hoặc https://vn.shp.ee/..." maxLength={2048} />
              </Form.Item>
              <Button type="primary" size="large" htmlType="submit" icon={<PlusOutlined />} loading={isSaving}>Lấy dữ liệu và lưu</Button>
            </div>
          </Form>
        </Card>
      )}

      <Alert
        className="product-source-alert"
        type="warning"
        showIcon
        message="Dữ liệu được lấy từ API bên thứ ba không chính thức, có thể chậm, sai lệch hoặc yêu cầu API key trong tương lai."
      />

      {error && <Alert className="data-alert product-error-alert" type="error" message={error} showIcon closable onClose={() => setError('')} />}

      <Card
        className="panel-card table-card"
        title={<Space><ShoppingOutlined className="panel-title-icon list" /><span>Danh sách sản phẩm</span></Space>}
        extra={<Input className="search-input product-search-input" prefix={<SearchOutlined />} placeholder="Tìm tên, shop, ngành hàng, ghi chú..." value={search} onChange={(event) => setSearch(event.target.value)} allowClear />}
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={filteredProducts}
          loading={isLoading}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          scroll={{ x: 1060 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={search ? 'Không tìm thấy sản phẩm phù hợp' : 'Chưa có sản phẩm nào'} /> }}
        />
      </Card>
    </>
  )
}
