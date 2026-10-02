# React + Vite

## Đồng bộ Telegram mỗi giờ

Workflow `.github/workflows/telegram-hourly-sync.yml` chạy vào phút 17 mỗi giờ,
đọc mọi tin nhắn mới từ `@magiamgiavoucher`, nhận diện mã/link và ghi vào
collection Firestore `todo`. Mốc tin nhắn cuối được lưu tại
`_syncState/telegram_magiamgiavoucher` để tránh đọc và ghi trùng.
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

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
