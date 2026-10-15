# Bio App

Ứng dụng chia sẻ cảm nghĩ, có đăng ký/đăng nhập, đăng bài, tệp đính kèm,
bình luận và thả tim.

## Yêu cầu
- Node.js 18 trở lên (khuyến nghị phiên bản LTS).
- Trên một số hệ điều hành, `better-sqlite3` có thể cần công cụ build nếu không có binary dựng sẵn.

## Cài đặt
```bash
npm install
```

## Chạy
```bash
npm start
```

## Truy cập
Mở http://localhost:3000 trong trình duyệt.

## Lưu ý
- Cơ sở dữ liệu `database.db` và tệp tải lên trong `uploads/` được tạo khi chạy.
- Trước khi triển khai công khai, hãy đặt biến môi trường `SESSION_SECRET` thành một chuỗi bí mật riêng.
- Giới hạn tệp tải lên hiện là 20 MB.
