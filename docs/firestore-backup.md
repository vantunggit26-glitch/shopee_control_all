# Sao lưu Firestore về máy

Chạy ở thư mục dự án, sau khi đã cài Firebase CLI bằng `npm install -g firebase-tools` và đăng nhập bằng `firebase login`:

```powershell
npm run db:backup
```

Lệnh hỏi mật khẩu backup hai lần, nhập ẩn, tối thiểu 12 ký tự. Mỗi lần chạy tạo file `.json.gz.enc` mới trong `backups/`. File được nén rồi mã hóa AES-256-GCM với khóa dẫn xuất từ mật khẩu bằng PBKDF2-SHA-256. Hãy giữ mật khẩu backup ở nơi riêng. Mật khẩu này độc lập với mật khẩu chính của kho đăng nhập.

Script dùng phiên Firebase CLI trên máy và không đưa token đăng nhập vào backup. Trên máy cài CLI ở vị trí khác, đặt `FIREBASE_TOOLS_AUTH_MODULE` thành đường dẫn tuyệt đối đến `firebase-tools/lib/auth.js`. Với tác vụ tự động, có thể cấp `ACCOUNT_VAULT_BACKUP_PASSWORD` từ kho secret của môi trường chạy.

Script chỉ đọc database `(default)` của `account-vault-tung`, lấy snapshot cùng một `readTime` và duyệt mọi collection con, kể cả khi document cha không tồn tại. Các kiểu dữ liệu Firestore được giữ nguyên theo định dạng REST: timestamp, số nguyên lớn, bytes, reference, map, array. Ảnh Base64 cũng được sao lưu. Script phải hoàn tất trong khoảng thời gian snapshot còn đọc được (thông thường một giờ).

File JSON nén có checksum SHA-256 và được đọc lại để xác minh ngay khi xuất xong. Đây là bản sao dữ liệu Firestore, **không** gồm người dùng Firebase Authentication, file Cloud Storage, mã nguồn Hosting, rules hoặc indexes. Hãy giữ mã nguồn/cấu hình trong Git riêng. Nếu ảnh chỉ là một URL ngoài thì backup chỉ chứa URL, không tải file ảnh đó.

## Kiểm tra và khôi phục

Thay `<ten-file>` bằng tên file script vừa in ra:

```powershell
npm run db:verify -- --file "backups/<ten-file>.json.gz.enc"
npm run db:restore -- --file "backups/<ten-file>.json.gz.enc"
```

Lệnh restore mặc định **chỉ kiểm tra file và hiển thị kế hoạch**, chưa kết nối/ghi database. Khi đã kiểm tra bản sao và thực sự muốn khôi phục:

```powershell
npm run db:restore -- --file "backups/<ten-file>.json.gz.enc" --apply --confirm-project account-vault-tung
```

Mặc định bỏ qua document đã có và chỉ tạo lại document bị thiếu, không xóa document nào khác. Thêm `--overwrite` nếu muốn thay thế nội dung document đã có bằng bản sao; thao tác này sẽ ghi đè các thay đổi mới hơn. UID và đường dẫn được giữ nguyên, nên khi tạo lại người dùng Auth cần đúng UID cũ để ứng dụng đọc được dữ liệu cá nhân. Các trường thời gian trong dữ liệu được giữ lại, còn metadata hệ thống `createTime`/`updateTime` do Firestore tạo mới khi khôi phục.

Nếu bản sao chứa cấu hình kho đăng nhập khác với kho hiện tại, lệnh khôi phục dừng trước khi ghi. Cần giữ mật khẩu chính tương ứng với thông tin đăng nhập đã mã hóa trong backup.

Các file cũ `.json.gz` vẫn có thể được kiểm tra và khôi phục. Để tạo bản mã hóa từ một file cũ, chạy:

```powershell
npm run db:protect -- --file "backups/<ten-file-cu>.json.gz"
```

Lệnh giữ nguyên file gốc và tạo một file `.enc` đã xác minh. File gốc chỉ được nén, nên cần cất riêng ở nơi an toàn. Thư mục `backups/` đã được loại khỏi Git.

Không cần nâng cấp Blaze cho cách đọc dữ liệu này; các lượt đọc vẫn tiêu thụ hạn mức Firestore hiện có. Khôi phục tiêu thụ lượt đọc/ghi. Nên chạy backup trước các thay đổi lớn và định kỳ theo nhu cầu; script không tự tạo lịch chạy nền.
