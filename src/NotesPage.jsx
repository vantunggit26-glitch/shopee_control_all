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
  Spin,
  Statistic,
  Table,
  Tooltip,
  Typography,
} from 'antd'
import { CopyOutlined, DeleteOutlined, ExportOutlined, FileTextOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from './firebase'
import { getNoteUrl, MAX_NOTE_LENGTH } from './noteUtils'

const { Title, Text, Paragraph } = Typography

export default function NotesPage({ user }) {
  const { message } = AntApp.useApp()
  const [form] = Form.useForm()
  const [notes, setNotes] = useState([])
  const [drafts, setDrafts] = useState({})
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isAdding, setIsAdding] = useState(false)
  const [savingIds, setSavingIds] = useState(() => new Set())
  const [deletingIds, setDeletingIds] = useState(() => new Set())
  const [readError, setReadError] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setReadError('Tải ghi chú quá lâu. Hãy kiểm tra kết nối và mở lại trang.')
      setIsLoading(false)
    }, 12000)
    const unsubscribe = onSnapshot(
      query(collection(db, 'users', user.uid, 'notes'), orderBy('createdAt', 'desc')),
      (snapshot) => {
        window.clearTimeout(timeout)
        setNotes(snapshot.docs.map((note) => ({ id: note.id, ...note.data() })))
        setReadError('')
        setIsLoading(false)
      },
      () => {
        window.clearTimeout(timeout)
        setReadError('Không thể tải ghi chú. Hãy tải lại trang hoặc đăng nhập lại.')
        setIsLoading(false)
      },
    )
    return () => {
      window.clearTimeout(timeout)
      unsubscribe()
    }
  }, [user.uid])

  const filteredNotes = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('vi')
    return notes.filter((note) => !keyword || note.text.toLocaleLowerCase('vi').includes(keyword))
  }, [notes, search])

  function clearDraft(id, submittedDraft) {
    setDrafts((current) => {
      if (current[id] !== submittedDraft) return current
      const next = { ...current }
      delete next[id]
      return next
    })
  }

  async function addNote(values) {
    if (isAdding) return
    const text = values.text.trim()
    if (!text || text.length > MAX_NOTE_LENGTH) return
    setIsAdding(true)
    setError('')
    try {
      await addDoc(collection(db, 'users', user.uid, 'notes'), {
        text,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      form.resetFields()
      message.success('Đã lưu ghi chú')
    } catch {
      setError('Không thể thêm ghi chú. Nội dung bạn nhập vẫn được giữ lại để thử lại.')
    } finally {
      setIsAdding(false)
    }
  }

  async function saveNote(note) {
    if (savingIds.has(note.id) || !(note.id in drafts)) return
    const submittedDraft = drafts[note.id]
    const text = submittedDraft.trim()
    if (!text) {
      setError('Ghi chú không được để trống. Hãy nhập nội dung hoặc xóa ghi chú này.')
      return
    }
    if (text.length > MAX_NOTE_LENGTH) return
    if (text === note.text) {
      clearDraft(note.id, submittedDraft)
      return
    }
    setSavingIds((current) => new Set(current).add(note.id))
    setError('')
    try {
      await updateDoc(doc(db, 'users', user.uid, 'notes', note.id), {
        text,
        updatedAt: serverTimestamp(),
      })
      clearDraft(note.id, submittedDraft)
      message.success('Đã cập nhật ghi chú')
    } catch {
      setError('Không thể lưu thay đổi. Nội dung đang sửa vẫn được giữ lại; bấm vào ô rồi ra ngoài để thử lại.')
    } finally {
      setSavingIds((current) => {
        const next = new Set(current)
        next.delete(note.id)
        return next
      })
    }
  }

  async function removeNote(id) {
    setDeletingIds((current) => new Set(current).add(id))
    setError('')
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'notes', id))
      setDrafts((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      message.success('Đã xóa ghi chú')
    } catch {
      setError('Không thể xóa ghi chú. Vui lòng thử lại.')
    } finally {
      setDeletingIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }
  }

  async function copyNote(text) {
    try {
      await navigator.clipboard.writeText(text)
      message.success('Đã sao chép ghi chú')
    } catch {
      message.error('Không thể sao chép. Bạn có thể chọn nội dung trong ô và sao chép thủ công.')
    }
  }

  const columns = [
    {
      title: 'Ghi chú',
      key: 'text',
      render: (_value, note) => (
        <div className="note-editor">
          <Input.TextArea
            value={drafts[note.id] ?? note.text}
            maxLength={MAX_NOTE_LENGTH}
            autoSize={{ minRows: 2, maxRows: 10 }}
            disabled={savingIds.has(note.id) || deletingIds.has(note.id)}
            onChange={(event) => setDrafts((current) => ({ ...current, [note.id]: event.target.value }))}
            onBlur={() => saveNote(note)}
            aria-label="Nội dung ghi chú, bấm để chỉnh sửa"
          />
          {savingIds.has(note.id) && <Text type="secondary"><Spin size="small" /> Đang lưu...</Text>}
        </div>
      ),
    },
    {
      title: 'Hành động',
      key: 'action',
      width: 132,
      align: 'center',
      render: (_value, note) => {
        const text = drafts[note.id] ?? note.text
        const url = getNoteUrl(text)
        return (
          <Space size={2}>
            <Tooltip title="Sao chép ghi chú">
              <Button type="text" icon={<CopyOutlined />} disabled={!text} onClick={() => copyNote(text)} aria-label="Sao chép ghi chú" />
            </Tooltip>
            {url && (
              <Tooltip title="Mở liên kết trong tab mới">
                <Button type="text" icon={<ExportOutlined />} href={url} target="_blank" rel="noopener noreferrer" aria-label="Mở liên kết ghi chú" />
              </Tooltip>
            )}
            <Popconfirm title="Xóa ghi chú này?" okText="Xóa" cancelText="Hủy" okButtonProps={{ danger: true }} onConfirm={() => removeNote(note.id)}>
              <Button type="text" danger icon={<DeleteOutlined />} disabled={savingIds.has(note.id)} loading={deletingIds.has(note.id)} aria-label="Xóa ghi chú" />
            </Popconfirm>
          </Space>
        )
      },
    },
  ]

  return (
    <>
      <section className="welcome-section">
        <div>
          <Text className="section-kicker">GHI NHỚ CÁ NHÂN</Text>
          <Title level={2}>Ghi chú</Title>
          <Paragraph type="secondary">Lưu nội dung và liên kết để sử dụng nhanh trên mọi thiết bị.</Paragraph>
        </div>
        <Card className="stat-card" variant="borderless"><Statistic title="Ghi chú đã lưu" value={notes.length} prefix={<FileTextOutlined />} /></Card>
      </section>

      <Card className="panel-card" title={<Space><PlusOutlined className="panel-title-icon add" /><span>Thêm ghi chú</span></Space>}>
        <Form form={form} layout="vertical" requiredMark={false} onFinish={addNote}>
          <Form.Item name="text" rules={[
            { required: true, whitespace: true, message: 'Nhập nội dung ghi chú' },
            { max: MAX_NOTE_LENGTH, message: `Ghi chú tối đa ${MAX_NOTE_LENGTH} ký tự` },
          ]}>
            <Input.TextArea placeholder="Nhập ghi chú hoặc dán đường dẫn https://..." maxLength={MAX_NOTE_LENGTH} showCount autoSize={{ minRows: 3, maxRows: 8 }} disabled={isAdding} aria-label="Ghi chú mới" />
          </Form.Item>
          <Button type="primary" htmlType="submit" icon={<PlusOutlined />} loading={isAdding}>Lưu ghi chú</Button>
        </Form>
      </Card>

      {(error || readError) && <Alert className="notes-error-alert" type="error" showIcon message={error || readError} />}
      <Card className="panel-card table-card notes-table-card" title={<Space><FileTextOutlined className="panel-title-icon list" /><span>Danh sách ghi chú</span></Space>} extra={(
        <Input className="search-input" prefix={<SearchOutlined />} placeholder="Tìm nội dung ghi chú..." value={search} onChange={(event) => setSearch(event.target.value)} allowClear />
      )}>
        <Paragraph className="notes-table-hint" type="secondary">Bấm vào nội dung để sửa. Thay đổi được tự động lưu khi bạn bấm ra ngoài ô.</Paragraph>
        <Table rowKey="id" columns={columns} dataSource={filteredNotes} loading={isLoading} pagination={false} tableLayout="fixed" locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={search ? 'Không tìm thấy ghi chú phù hợp' : 'Chưa có ghi chú nào'} /> }} />
      </Card>
    </>
  )
}
