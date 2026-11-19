# Khôi phục đồng bộ Telegram trên GitHub Actions

## Lỗi đã xác định

Lượt chạy ngày 17/11/2026 báo `Concurrent usage of the current session from multiple connections ... session was invalidated`. Đây là lỗi `AUTH_KEY_DUPLICATED`: cùng authorization key được dùng ở nhiều kết nối. Telegram đã thu hồi key, nên chỉnh cron hoặc bấm Re-run với cùng secret cũ sẽ không giải quyết được.

Tài liệu: https://core.telegram.org/api/errors

## Tạo session dành riêng cho GitHub Actions

Trong terminal tương tác ở thư mục dự án, chạy:

```powershell
npm ci --prefix functions
npm run telegram:actions-session
```

Lệnh dùng `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_PHONE` từ `.env.telegram.local` nếu có. Nếu chưa cấu hình, chương trình hỏi trực tiếp. API ID/Hash lấy từ ứng dụng của bạn tại https://my.telegram.org/apps. Nhập mã đăng nhập nhận được trong Telegram và mật khẩu xác minh hai bước nếu tài khoản yêu cầu; các thông tin này được nhập ẩn trong terminal, không gửi vào chat.

Màn hình lần lượt hỏi `[1/3] API ID` (chỉ dãy số), `[2/3] API Hash` (32 ký tự, nhập ẩn), `[3/3] số điện thoại`. Nhập xong từng ô và nhấn Enter; không dán lệnh `clip`/`Get-Content` vào các ô này. Nếu nhập sai, chương trình sẽ nêu đúng trường cần sửa và hỏi lại trường đó. Với API Hash, khi nhấn Enter sẽ có dòng xác nhận đã nhận 32 ký tự; lúc gõ không hiển thị ký tự là bình thường. Không cần tạo file `.env.telegram.local` nếu nhập trực tiếp.

Lệnh luôn tạo authorization key mới, không đọc `.telegram/session.txt` của listener local, không đọc/ghi Firestore, và ngắt kết nối trước khi tạo file `.telegram/github-actions-session.txt`. Session không được in ra console. Nếu file đã tồn tại, đổi tên file đó trước khi tạo mới; lệnh không tự ghi đè.

Sau khi thành công, sao chép nội dung file trên máy:

```powershell
Get-Content -Raw -LiteralPath .telegram/github-actions-session.txt | Set-Clipboard
```

Mở [Repository secrets](https://github.com/vantunggit26-glitch/shopee_control_all/settings/secrets/actions), chọn secret `TELEGRAM_SESSION`, bấm **Update**, dán và lưu. Ba secret còn lại giữ nguyên. File `.telegram/` đã bị loại khỏi Git; không commit hoặc chia sẻ file session.

## Chạy lại và xác nhận

1. Mở [workflow Telegram sync every 20 minutes](https://github.com/vantunggit26-glitch/shopee_control_all/actions/workflows/telegram-hourly-sync.yml).
2. Chọn **Run workflow**, nhánh `main`, rồi chạy. Cách này dùng mã mới nhất; Re-run một lượt cũ sẽ chạy lại commit cũ.
3. Bước `Synchronize Telegram messages` phải báo đồng bộ từng kênh thành công. Nếu còn lỗi, xem dòng lỗi và Job Summary mới để xác định.

Nhóm `concurrency` cố định `telegram-session-sync` ngăn các lượt workflow này trong cùng repository chạy song song. Nếu thêm workflow khác dùng cùng secret trong repository, phải dùng cùng group. Group không khóa được tiến trình trên máy riêng hoặc repository khác, nên session Actions phải được dùng riêng. Nếu vẫn cần listener local, đăng nhập tạo session riêng cho listener và giữ ở `.telegram/session.txt`.

Cloudflare Worker `shopee-telegram-sync-trigger` gọi GitHub Actions mỗi 20 phút. Các lượt tự động xuất hiện dưới sự kiện `workflow_dispatch` như lượt thủ công. Xem log `scheduled` trong tab **Observability** của Worker để biết lượt nào đã gửi, bỏ qua vì job đang chờ hoặc đang chạy, hay gặp lỗi khi gọi GitHub. Nếu nghi lỗi kết nối Telegram, dùng `Run workflow` để kiểm tra trực tiếp trên GitHub.
