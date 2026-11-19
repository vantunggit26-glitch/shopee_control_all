# React + Vite

## Ghi chú cá nhân

Sau khi đăng nhập, chọn **Ghi chú** trên menu để thêm nội dung hoặc URL.
Bảng có hai cột: ô nội dung có thể sửa trực tiếp (tự lưu khi rời ô) và hành động
sao chép, mở URL trong tab mới, xóa. Chỉ hiện nút mở URL cho ghi chú là một
đường dẫn HTTP/HTTPS hoặc bắt đầu bằng `www.`. Ghi chú tối đa 5000 ký tự,
lưu riêng tại `users/{uid}/notes` và đồng bộ giữa các thiết bị cùng tài khoản.

## Sao lưu dữ liệu Firebase về máy

Chạy `npm run db:backup` để lưu toàn bộ Firestore và ảnh Base64 vào `backups/`.
File được nén, mã hóa bằng mật khẩu backup, có checksum và không được đưa lên Git.
Xem [hướng dẫn kiểm tra và khôi phục](docs/firestore-backup.md).

## Kho sản phẩm Shopee và Lazada

Quản trị viên có thể chọn sàn, dán link sản phẩm Shopee/Lazada rồi lưu vào
chung collection Firestore `products`. Link Lazada đầy đủ và link rút gọn
`s.lazada.vn` đều được hỗ trợ. Bảng sản phẩm dùng chung có nhãn và bộ lọc theo
sàn; các tài liệu Shopee cũ chưa có trường `platform` vẫn được nhận diện là
Shopee.

Dữ liệu sản phẩm được lấy qua API AddLiveTag bên thứ ba. Cấu hình API key nằm
trong `privateConfig/addlivetag`; không ghi API key, cookie hoặc mật khẩu vào mã
nguồn. Dữ liệu Lazada có thể thiếu đánh giá hoặc một số trường khác, khi đó giao
diện hiển thị “Chưa có dữ liệu” thay vì tự tạo giá trị.

## Đồng bộ Telegram mỗi 20 phút

Cloudflare Worker `shopee-telegram-sync-trigger` gọi workflow
`.github/workflows/telegram-hourly-sync.yml` vào các phút 7, 27, 47 mỗi giờ.
GitHub có thể xếp hàng sau khi nhận yêu cầu. Workflow đọc tin mới
từ `@magiamgiavoucher` vào `todo`, và `@magiamgia_deal0d_shopee` vào
`todoAuthenticated`, theo các từ khóa trong `functions/index.js`.
Mốc tin nhắn cuối của từng kênh lưu trong `_syncState` để tránh ghi trùng.
Mỗi bản ghi Telegram có `expiresAt` và được tự động xóa sau 5 ngày trong lượt
đồng bộ kế tiếp.

Tab **Lắng nghe mã** chỉ hiển thị sau khi đăng nhập. Tab mặc định lọc các tin
trong ngày có chứa `Người mới`, đồng thời cho phép xem mọi tin trong 5 ngày.

Repository cần có bốn GitHub Actions secrets:

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION`
- `FIREBASE_SERVICE_ACCOUNT_JSON`

Workflow cũng hỗ trợ chạy thủ công bằng nút **Run workflow** trong tab Actions.

`TELEGRAM_SESSION` phải là session riêng cho workflow, không dùng chung với
listener local hoặc repository khác. Nếu log báo `AUTH_KEY_DUPLICATED` hoặc
`Concurrent usage of the current session`, Telegram đã thu hồi session cũ:
xem [hướng dẫn tạo session riêng và khôi phục Actions](docs/telegram-actions-recovery.md).

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
