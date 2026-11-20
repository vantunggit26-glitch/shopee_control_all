import { useState } from 'react'
import { Alert, App, Button, Collapse, Form, Input, Modal, Select, Space, Switch, Typography } from 'antd'
import { BellOutlined, CopyOutlined } from '@ant-design/icons'

const gmail = /^[\w.+-]+@(?:gmail|googlemail)\.com$/i
const { Text, Link } = Typography

export default function VoucherAlertSettings({ user, workerUrl }) {
  const [form] = Form.useForm()
  const { message } = App.useApp()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saved, setSaved] = useState(null)
  const [connectionOpen, setConnectionOpen] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  async function request(method, suffix = '', body) {
    const token = await user.getIdToken()
    const response = await fetch(new URL(`/voucher-alerts${suffix}`, workerUrl), {
      method,
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body && { 'Content-Type': 'application/json' }),
      },
      ...(body && { body: JSON.stringify(body) }),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || 'Chưa thể kết nối chức năng thông báo.')
    return result
  }

  async function loadSettings() {
    setOpen(true)
    setPending('load')
    setLoaded(false)
    setSaved(null)
    setConnectionOpen(false)
    setCode('')
    setError('')
    try {
      const { settings } = await request('GET')
      form.setFieldsValue(settings ?? { keyword: 'Mã người mới giảm', emails: [], enabled: true })
      setSaved(settings)
      setLoaded(true)
    } catch (err) {
      setError(err.message || 'Không đọc được cấu hình thông báo.')
    } finally {
      setPending('')
    }
  }

  async function saveSettings(values) {
    setPending('save')
    setError('')
    try {
      const result = await request('PUT', '', values)
      setSaved(result.settings)
      form.setFieldsValue(result.settings)
      if (result.connectionCode) showConnectionCode(result.connectionCode)
      message.success('Đã lưu thông báo.')
    } catch (err) {
      setError(err.message || 'Không lưu được thông báo.')
    } finally {
      setPending('')
    }
  }

  async function renewCode() {
    setPending('connect')
    setError('')
    try {
      const result = await request('POST', '/connect')
      showConnectionCode(result.connectionCode)
    } catch (err) {
      setError(err.message || 'Không tạo được mã kết nối.')
    } finally {
      setPending('')
    }
  }

  function showConnectionCode(connectionCode) {
    setCode(connectionCode)
    setConnectionOpen(true)
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code)
      message.success('Đã sao chép mã kết nối.')
    } catch {
      message.error('Hãy chọn và sao chép mã trong ô bên dưới.')
    }
  }

  return (
    <>
      <Button icon={<BellOutlined />} onClick={loadSettings}>Tạo thông báo</Button>
      <Modal
        title="Thông báo tin ưu đãi qua Gmail"
        open={open}
        onCancel={() => { setOpen(false); setCode('') }}
        onOk={() => form.submit()}
        okText="Lưu thông báo"
        cancelText="Đóng"
        okButtonProps={{ disabled: !loaded || Boolean(pending) }}
        confirmLoading={pending === 'save'}
        cancelButtonProps={{ disabled: Boolean(pending) }}
        closable={!pending}
        maskClosable={false}
        keyboard={!pending}
        forceRender
      >
        {error && <Alert type="error" showIcon message={error} />}
        {pending === 'load' && <Text type="secondary">Đang tải cấu hình…</Text>}
        <Form form={form} layout="vertical" onFinish={saveSettings} disabled={!loaded || Boolean(pending)}>
          <Form.Item name="keyword" label="Từ khóa" rules={[
            { required: true, whitespace: true, message: 'Hãy nhập từ khóa.' },
            { min: 3, max: 120, message: 'Từ khóa cần từ 3–120 ký tự.' },
          ]}>
            <Input maxLength={120} placeholder="Ví dụ: Mã người mới giảm" />
          </Form.Item>
          <Form.Item name="emails" label="Gmail nhận thông báo"
            extra="Nhấn Enter hoặc dùng dấu phẩy để thêm từng địa chỉ. Tối đa 10 Gmail."
            rules={[{ validator: (_, values) => (
              values?.length && values.length <= 10 && values.every((email) => gmail.test(email.trim()))
                ? Promise.resolve() : Promise.reject(new Error('Nhập từ 1–10 địa chỉ Gmail hợp lệ.'))
            ) }]}>
            <Select mode="tags" tokenSeparators={[',', ';', ' ', '\n']} maxCount={10}
              open={false} placeholder="Ví dụ: tenban@gmail.com" />
          </Form.Item>
          <Form.Item name="enabled" label="Bật thông báo" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
        {saved && (
          <Collapse
            className="voucher-alert-connection"
            ghost
            size="small"
            activeKey={connectionOpen ? ['connection'] : []}
            onChange={(keys) => setConnectionOpen(keys.includes('connection'))}
            items={[{
              key: 'connection',
              label: 'Cài đặt kết nối',
              children: (
                <>
                  <ol>
                    <li>Thay mã trong tệp Apps Script hiện có bằng <Link href="/voucher-alerts.gs" download>Tải mã Apps Script</Link>.</li>
                    <li>Trong <strong>Cài đặt dự án → Thuộc tính tập lệnh</strong>, thêm <Text code>ACCOUNT_VAULT_ALERT_CODE</Text> với giá trị là mã kết nối.</li>
                    <li>Lưu rồi chạy hàm <Text code>installAlerts</Text>. Hàm giữ lại lịch <Text code>checkVouchers</Text> nếu đã có.</li>
                  </ol>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {code ? (
                      <>
                        <Text type="secondary">Sao chép mã trước khi đóng. Chỉ dán mã vào dự án Apps Script của bạn.</Text>
                        <Space.Compact style={{ width: '100%' }}>
                          <Input.Password value={code} readOnly aria-label="Mã kết nối Apps Script" />
                          <Button icon={<CopyOutlined />} onClick={copyCode}>Sao chép</Button>
                        </Space.Compact>
                      </>
                    ) : (
                      <>
                        <Button size="small" onClick={renewCode} loading={pending === 'connect'}
                          disabled={Boolean(pending)}>Cấp lại mã kết nối</Button>
                        <Text type="secondary">Khi cấp lại mã, hãy thay mã trong Apps Script.</Text>
                      </>
                    )}
                  </Space>
                </>
              ),
            }]}
          />
        )}
      </Modal>
    </>
  )
}
