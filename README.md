# Sổ bán vé số

App trên điện thoại để ghi công nợ khách mua vé số kiến thiết, xem báo cáo doanh thu, tra cứu kết quả xổ số ba miền và hỏi trợ lý Gemini về sổ sách.

- **Giao diện:** HTML/JavaScript thuần, chạy trên GitHub Pages, cài được như app (PWA).
- **Dữ liệu:** Google Sheet của bạn, đọc ghi qua Google Apps Script.
- **Trợ lý:** Gemini, gọi từ Apps Script nên khoá API không bao giờ nằm trên GitHub.

```
so-ban-ve-so/
├── apps-script/Code.gs   ← dán vào Google Apps Script (máy chủ)
├── index.html, style.css, app.js, sw.js, manifest.json, icons/   ← đưa lên GitHub Pages
```

---

## Bước 1. Tạo Google Sheet và Apps Script

1. Vào [sheets.new](https://sheets.new) để tạo một bảng tính mới, đặt tên ví dụ **Sổ bán vé số**.
2. Chọn menu **Tiện ích mở rộng → Apps Script**.
3. Xoá hết code mẫu, dán toàn bộ nội dung file `apps-script/Code.gs` vào, rồi bấm **Lưu** (biểu tượng đĩa).
4. Ở thanh trên, chọn hàm **setup** rồi bấm **Chạy**. Google sẽ hỏi cấp quyền: chọn tài khoản, bấm **Nâng cao → Đi tới … (không an toàn) → Cho phép**. Cảnh báo này hiện ra vì script do chính bạn viết và chưa được Google duyệt.
5. Mở **Nhật ký thực thi** ở phía dưới, chép lại dòng `APP_TOKEN = …`. Đây là **mã truy cập**, bạn sẽ nhập nó vào app ở bước 4.

Sau bước này, Sheet có thêm hai trang tính **KhachHang** và **GiaoDich**. Đừng đổi tên hai trang này hay dòng tiêu đề của chúng.

## Bước 2. Thêm khoá Gemini

1. Trong Apps Script, bấm biểu tượng bánh răng **Cài đặt dự án**.
2. Kéo xuống phần **Thuộc tính tập lệnh**, bấm **Thêm thuộc tính tập lệnh**:
   - Thuộc tính: `GEMINI_API_KEY`
   - Giá trị: khoá Gemini của bạn
3. Không bắt buộc: thêm `GEMINI_MODEL` để dùng mô hình khác. Nếu không thêm, app mặc định dùng `gemini-2.5-flash`.
4. Bấm **Lưu thuộc tính tập lệnh**.

## Bước 3. Triển khai API

1. Bấm **Triển khai → Tùy chọn triển khai mới**.
2. Bấm bánh răng cạnh "Chọn loại", chọn **Ứng dụng web**, rồi đặt:
   - **Thực thi với tư cách:** Tôi
   - **Người có quyền truy cập:** Bất kỳ ai
3. Bấm **Triển khai** và chép **URL ứng dụng web** (kết thúc bằng `/exec`). Đây là **đường dẫn kết nối**.

> Chọn "Bất kỳ ai" là cần thiết để app trên GitHub gọi được vào script. Dữ liệu vẫn an toàn, vì mọi yêu cầu không kèm đúng mã truy cập đều bị từ chối. Bản thân Sheet vẫn chỉ mình bạn mở được.

**Khi sửa `Code.gs` về sau**, vào **Triển khai → Quản lý các bản triển khai → ✏️ → Phiên bản: Phiên bản mới → Triển khai**. Làm theo cách này thì đường dẫn giữ nguyên. Nếu tạo "Triển khai mới" thì sẽ ra đường dẫn khác.

## Bước 4. Đưa giao diện lên GitHub Pages

1. Trên GitHub, tạo repository mới, ví dụ `so-ve-so`, để chế độ **Public**. Pages miễn phí yêu cầu repo public; trong code không có mã hay khoá nào nên public vẫn an toàn.
2. Bấm **Add file → Upload files** và kéo vào: `index.html`, `style.css`, `app.js`, `sw.js`, `manifest.json` và cả thư mục `icons`. Thư mục `apps-script` không cần đưa lên, nhưng có đưa lên cũng không sao.
3. Vào **Settings → Pages**, phần **Source** chọn **Deploy from a branch**, nhánh **main**, thư mục **/(root)**, rồi bấm **Save**.
4. Khoảng 1–2 phút sau, app có ở địa chỉ `https://<tên-github>.github.io/so-ve-so/`.

## Bước 5. Cài lên điện thoại

1. Trong Apps Script, chạy hàm **setup**. Nhật ký in ra **MÃ TRUY CẬP** (12 ký tự, vd `K7PM-X3QR-9TWD`) và một **link**.
2. Mở link đó trên điện thoại là vào sổ luôn. Hoặc mở app rồi gõ mã truy cập (hoa hay thường đều được) → **Vào sổ**.
   Đường dẫn máy chủ đã cài sẵn trong `app.js` (`DEFAULT_API`); nếu triển khai Apps Script mới thì sửa dòng đó.
3. Thêm app ra màn hình chính:
   - **Android (Chrome):** menu ⋮ → **Thêm vào màn hình chính** (hoặc **Cài đặt ứng dụng**).
   - **iPhone (Safari):** nút Chia sẻ → **Thêm vào MH chính**.

---

## Cách dùng

App có 3 tab:

- **💬 Ghi sổ:** nhắn giống nhắn Zalo, ví dụ `cô Ba lấy 50 trả 30`, `anh Phúc trả 100`, `chú Tư lấy 1500 trả đủ`, `bà Sáu trả hết nợ`. App hiện thẻ xác nhận, bấm **✅ Đúng, ghi sổ** là xong. Ghi nhầm thì bấm **Hoàn tác**.
  - Số tiền tính bằng **nghìn đồng**: `500` hay `500k` là 500.000đ, `1500` là 1.500.000đ, `1tr2` là 1.200.000đ.
  - Tên chưa có trong sổ: app gợi ý các khách có tên gần giống, hoặc cho thêm khách mới.
  - Hỏi luôn trong khung này: "Ai đang nợ?", "Hôm nay bán bao nhiêu?", "Tổng kết tuần", hoặc câu hỏi bất kỳ về sổ. Câu nào app không tự hiểu được thì gửi cho Gemini.
  - Chủ nhật mở app sẽ tự hiện bảng tổng kết tuần: doanh thu và danh sách khách nợ.
- **👥 Khách:** danh sách giống Zalo, khách nợ nhiều nhất ở trên cùng. Bấm vào khách để xem lịch sử, **📤 Nhắc nợ** (gửi tin nhắn soạn sẵn qua Zalo/Messenger) hoặc gọi điện. Nút **📊 Báo cáo** dẫn tới biểu đồ tiền vé theo ngày và nút tải sổ về máy dạng file Excel.
- **🎫 Kết quả:** kết quả xổ số miền Nam, Trung, Bắc những ngày gần đây, lấy từ xskt.com.vn và tự làm mới mỗi 15 phút.

Công nợ của khách thay đổi đúng bằng *tiền vé khách lấy* trừ *khách đã trả*.

Khi mất mạng, app vẫn mở được và hiện dữ liệu của lần tải gần nhất, nhưng chưa ghi sổ được.

## Bảo mật

- **Mã truy cập** chỉ lưu trong Apps Script và trên điện thoại của bạn.
- **Nếu lỡ lộ mã:** vào **Cài đặt dự án → Thuộc tính tập lệnh**, xoá `APP_TOKEN`, chạy lại hàm `setup` để lấy mã mới, rồi nhập mã mới vào app. Mã cũ hết tác dụng ngay.
- **Gửi gì cho Gemini:** khi bạn hỏi trợ lý, app gửi tên khách, số dư và giao dịch 180 ngày gần nhất lên Gemini. Số điện thoại và địa chỉ không được gửi. Với khoá Gemini miễn phí, Google có thể dùng nội dung này để cải thiện sản phẩm. Nếu không muốn vậy, hãy bật thanh toán cho dự án Gemini.

## Sửa giao diện

Sau khi sửa các file web và đưa lên GitHub, hãy tăng số phiên bản `VERSION` trong `sw.js` (ví dụ `svs-v1` → `svs-v2`) để điện thoại tải bản mới.
