import { useState } from 'react'
import { Alert, App, Button, Card, Empty, List, Space, Typography } from 'antd'
import { StarFilled, StarOutlined } from '@ant-design/icons'
import { safeVoucherUrl, voucherSaveKey } from './voucherUtils'

const { Link, Text } = Typography

export function VoucherSaveButton({ offer, saved }) {
  const { message } = App.useApp()
  const [saving, setSaving] = useState(false)
  if (!saved || !offer.url || !offer.title) return null
  const isSaved = saved.savedKeys.has(voucherSaveKey(offer))

  async function saveOffer() {
    setSaving(true)
    try {
      await saved.save(offer)
      message.success('Đã lưu ưu đãi')
    } catch {
      message.error('Không lưu được ưu đãi. Hãy thử lại.')
    } finally {
      setSaving(false)
    }
  }

  return <Button size="small" type="text" icon={isSaved ? <StarFilled /> : <StarOutlined />}
    loading={saving} disabled={isSaved} onClick={saveOffer}>{isSaved ? 'Đã lưu' : 'Lưu mã'}</Button>
}

export function SavedVouchers({ saved }) {
  const { message } = App.useApp()
  const [deleting, setDeleting] = useState('')
  async function remove(id) {
    setDeleting(id)
    try {
      await saved.remove(id)
    } catch {
      message.error('Không bỏ lưu được ưu đãi.')
    } finally {
      setDeleting('')
    }
  }

  return (
    <Card className="panel-card" title="Mã đã lưu">
      {saved.error && <Alert type="error" showIcon message={saved.error} />}
      <List
        loading={saved.loading}
        dataSource={saved.items}
        pagination={{ pageSize: 12, hideOnSinglePage: true }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa lưu ưu đãi nào" /> }}
        renderItem={(offer) => (
          <List.Item key={offer.id} actions={[
            <Button size="small" key="remove" type="text" loading={deleting === offer.id}
              disabled={Boolean(deleting && deleting !== offer.id)} onClick={() => remove(offer.id)}>Bỏ lưu</Button>,
          ]}>
            <Space direction="vertical" size={3}>
              <Text type="secondary">{offer.source === 'website' ? 'Website' : 'Telegram'}</Text>
              <Text>{offer.title}</Text>
              {safeVoucherUrl(offer.url) && <Link href={offer.url} target="_blank" rel="noopener noreferrer">Mở ưu đãi</Link>}
            </Space>
          </List.Item>
        )}
      />
    </Card>
  )
}
