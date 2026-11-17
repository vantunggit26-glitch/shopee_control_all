export function describeTelegramFailure(error) {
  const details = [error?.errorMessage, error?.code, error?.message, String(error)]
    .filter(Boolean).join(' ').toUpperCase()

  if (details.includes('AUTH_KEY_DUPLICATED')
    || details.includes('CONCURRENT USAGE OF THE CURRENT SESSION')) {
    return {
      title: 'Telegram session bị thu hồi do dùng trùng',
      message: 'Telegram đã vô hiệu hóa session dùng đồng thời ở nhiều kết nối. Chạy npm run telegram:actions-session trên máy, cập nhật GitHub secret TELEGRAM_SESSION bằng session mới và chỉ dùng session đó cho workflow này. Không dùng chung với listener local hoặc repository khác. Re-run với session cũ sẽ tiếp tục lỗi.',
    }
  }

  if (['AUTH_KEY_UNREGISTERED', 'AUTH_KEY_INVALID', 'SESSION_REVOKED', 'SESSION_EXPIRED',
    'SESSION ĐÃ HẾT HẠN', 'CHƯA ĐƯỢC ĐĂNG NHẬP'].some((code) => details.includes(code))) {
    return {
      title: 'Telegram session không còn hợp lệ',
      message: 'Cần đăng nhập Telegram lại. Chạy npm run telegram:actions-session, rồi cập nhật GitHub secret TELEGRAM_SESSION trước khi Run workflow trên nhánh main.',
    }
  }

  return { title: 'Đồng bộ Telegram thất bại', message: error?.message || 'Lỗi không xác định.' }
}

export function escapeAnnotation(value) {
  return String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}
