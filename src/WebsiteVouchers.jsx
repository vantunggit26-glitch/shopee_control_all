import { useEffect, useState } from 'react'
import { Alert, Button, Card, Empty, Input, Pagination, Select, Space, Spin, Typography } from 'antd'
import { ExportOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'

const { Link, Text, Title } = Typography
const SOURCE_URL = 'https://vouchersan.com/ma-hot/'
const WEBSITE_VOUCHERS_URL = 'https://shopee-website-vouchers.vantunggit26.workers.dev/vouchers'
const PAGE_SIZE = 10
const FEATURED_PAGE_SIZE = 6
const dateTime = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short',
})
const expiryDate = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short',
})
const localDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short' })
const platformNames = { shopee: 'Shopee', lazada: 'Lazada' }

function formatTime(value) {
  return dateTime.format(value * 1000)
}

function PlatformLabel({ platforms }) {
  return (
    <span className="website-voucher-platform">
      {platforms.map((platform) => platformNames[platform]).filter(Boolean).join(' · ') || 'Chưa rõ sàn'}
    </span>
  )
}

function OfferLinks({ links, label }) {
  return (
    <Space wrap size={12}>
      {links.map((url, index) => (
        <Link key={url} href={url} target="_blank" rel="noopener noreferrer sponsored">
          {links.length === 1 ? label : `Link ${index + 1}`} <ExportOutlined />
        </Link>
      ))}
    </Space>
  )
}

export default function WebsiteVouchers() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [platform, setPlatform] = useState('all')
  const [period, setPeriod] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [featuredPage, setFeaturedPage] = useState(1)
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    let controller
    let active = true

    async function load() {
      const current = new AbortController()
      controller?.abort()
      controller = current
      const timeout = window.setTimeout(() => current.abort(), 25_000)
      try {
        const response = await fetch(WEBSITE_VOUCHERS_URL, { signal: current.signal })
        if (!response.ok) throw new Error('Website feed unavailable')
        const result = await response.json()
        if (!active || controller !== current) return
        setData(result)
        setNow(Date.now())
        setError('')
      } catch {
        if (active && controller === current) setError('Chưa tải được dữ liệu VoucherSan. Hãy thử làm mới.')
      } finally {
        window.clearTimeout(timeout)
        if (active && controller === current) setLoading(false)
      }
    }

    void load()
    const interval = window.setInterval(load, 120_000)
    return () => {
      active = false
      controller?.abort()
      window.clearInterval(interval)
    }
  }, [reload])

  const today = localDay.format(now)
  const query = search.trim().normalize('NFKC').toLocaleLowerCase('vi')
  function matches(item) {
    return (platform === 'all' || item.platforms.includes(platform))
      && (period === 'all' || localDay.format(item.observedAt * 1000) === today)
      && [item.title, item.amount, item.minimumOrder, item.group, ...item.links].join(' ')
        .normalize('NFKC').toLocaleLowerCase('vi').includes(query)
  }
  const featured = data?.featured.filter(matches) ?? []
  const feed = data?.feed.filter(matches) ?? []
  const currentFeaturedPage = Math.min(featuredPage, Math.max(1, Math.ceil(featured.length / FEATURED_PAGE_SIZE)))
  const visibleFeatured = featured.slice((currentFeaturedPage - 1) * FEATURED_PAGE_SIZE, currentFeaturedPage * FEATURED_PAGE_SIZE)
  const currentPage = Math.min(page, Math.max(1, Math.ceil(feed.length / PAGE_SIZE)))
  const visibleFeed = feed.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const hasMissingSource = data && (!data.featuredUpdatedAt || !data.feedUpdatedAt)

  function resetPages() {
    setPage(1)
    setFeaturedPage(1)
  }

  return (
    <Card className="panel-card website-voucher-panel">
      <div className="website-voucher-heading">
        <div>
          <Title level={4}>Ưu đãi từ Website</Title>
          <Link href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
            Mở trang Mã hot của VoucherSan <ExportOutlined />
          </Link>
        </div>
        <Button
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={() => { setLoading(true); setReload((value) => value + 1) }}
        >
          Làm mới
        </Button>
      </div>
      <div className="website-voucher-filters">
        <div className="telegram-filter-field">
          <span>Sàn</span>
          <Select
            aria-label="Sàn của ưu đãi Website"
            value={platform}
            onChange={(value) => { setPlatform(value); resetPages() }}
            options={[{ value: 'all', label: 'Tất cả sàn' }, ...Object.entries(platformNames)
              .map(([value, label]) => ({ value, label }))]}
          />
        </div>
        <div className="telegram-filter-field">
          <span>Thời gian</span>
          <Select
            aria-label="Thời gian của ưu đãi Website"
            value={period}
            onChange={(value) => { setPeriod(value); resetPages() }}
            options={[{ value: 'today', label: 'Hôm nay' }, { value: 'all', label: '5 ngày gần đây' }]}
          />
        </div>
        <div className="telegram-filter-field">
          <span>Tìm kiếm</span>
          <Input
            aria-label="Tìm ưu đãi Website"
            prefix={<SearchOutlined />}
            allowClear
            placeholder="Mức giảm, điều kiện hoặc link"
            value={search}
            onChange={(event) => { setSearch(event.target.value); resetPages() }}
          />
        </div>
      </div>

      {(error || hasMissingSource) && (
        <Alert type="warning" showIcon message={error || 'Một phần dữ liệu VoucherSan đang tạm thời không khả dụng.'} />
      )}
      <Spin spinning={loading && !data}>
        {data && (
          <>
            <section className="website-voucher-section" aria-label="Mã nổi bật">
              <div className="website-voucher-heading">
                <Title level={5}>Mã nổi bật</Title>
                {data.featuredUpdatedAt && <Text type="secondary">Cập nhật {formatTime(data.featuredUpdatedAt)}</Text>}
              </div>
              {featured.length ? (
                <div className="website-voucher-grid">
                  {visibleFeatured.map((offer) => {
                    const expired = offer.expiresAt && offer.expiresAt * 1000 < now
                    return (
                      <article className="website-voucher-card" key={offer.id}>
                        <PlatformLabel platforms={offer.platforms} />
                        <strong className="website-voucher-amount">{offer.amount}</strong>
                        <Text type="secondary">{offer.minimumOrder}</Text>
                        <p>{offer.title}</p>
                        <div className="website-voucher-card-footer">
                          {offer.expiresAt && <Text type="secondary">{expired ? 'Đã hết hạn' : `HSD ${expiryDate.format(offer.expiresAt * 1000)}`}</Text>}
                          <OfferLinks links={offer.links} label="Mở ưu đãi" />
                        </div>
                      </article>
                    )
                  })}
                </div>
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có mã nổi bật phù hợp" />}
              {featured.length > FEATURED_PAGE_SIZE && (
                <Pagination size="small" current={currentFeaturedPage} pageSize={FEATURED_PAGE_SIZE} total={featured.length}
                  onChange={setFeaturedPage} showSizeChanger={false} />
              )}
            </section>

            <section className="website-voucher-section" aria-label="Tin ưu đãi mới">
              <div className="website-voucher-heading">
                <div>
                  <Title level={5}>Tin ưu đãi</Title>
                  <Text type="secondary">Lịch sử tích lũy từ nguồn, tối đa 5 ngày.</Text>
                </div>
                <Text type="secondary">{feed.length} tin</Text>
              </div>
              {visibleFeed.length ? (
                <div className="website-voucher-feed">
                  {visibleFeed.map((item) => (
                    <article key={item.id}>
                      <div className="website-voucher-feed-meta">
                        <PlatformLabel platforms={item.platforms} />
                        <Text type="secondary">{formatTime(item.publishedAt)}{item.kind === 'back' ? ' · Back lượt' : ''}</Text>
                      </div>
                      <p>{item.title}</p>
                      <OfferLinks links={item.links} label="Mở ưu đãi" />
                    </article>
                  ))}
                </div>
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có tin ưu đãi phù hợp" />}
              {feed.length > PAGE_SIZE && (
                <Pagination size="small" current={currentPage} pageSize={PAGE_SIZE} total={feed.length}
                  onChange={setPage} showSizeChanger={false} />
              )}
            </section>
          </>
        )}
      </Spin>
    </Card>
  )
}
