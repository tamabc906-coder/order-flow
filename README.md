# Order Flow

App xem **dòng lệnh mua/bán chủ động** cho danh mục KingStock: nến 5 phút có footprint, delta, CVD, dấu hiệu
order flow, và footprint nhiều phiên. Chạy độc lập: GitHub Actions gom dữ liệu sau phiên, GitHub Pages phục vụ PWA.
Không phụ thuộc price-path (chỉ nạp dữ liệu cũ một lần bằng `--seed`).

> Thống kê **mô tả**, không phải tín hiệu mua bán. order-flow-lab (25/09/2026) đo 16 phép order flow trên
> 39 mã × 47 phiên: 0/16 qua cổng.

## Luồng dữ liệu

```
KingStock /api/watchlist ──► job/watchlist.py (bản chụp docs/data/watchlist.json nếu Fly chết)
VNDirect stock_intraday_latest ──► common/vndirect.py ──► flow/ticks.py ──► data/store/<MÃ>/<ngày>.json   (nến 5', giữ mãi)
                                                                        └► flow/signals.py ─► docs/data/intraday/<ngày>/<MÃ>.json (60 phiên)
DNSE nến ngày (hệ số điều chỉnh) ──► flow/daily.py ──► docs/data/daily/<MÃ>.json (40 phiên), latest.json, state.json
```

## Chạy trên máy

```
venv\Scripts\python -m pytest -q
venv\Scripts\python -m job.run_daily            # gom phiên gần nhất + dựng docs/data
venv\Scripts\python -m job.run_daily --rebuild  # dựng lại từ kho, không gọi VNDirect (sau khi sửa flow/)
cd docs && ..\venv\Scripts\python -m http.server 8765
```
Console Windows cần `PYTHONIOENCODING=utf-8` (in tiếng Việt).

Chụp headless để kiểm giao diện: `msedge --headless=new --virtual-time-budget=15000 --window-size=520,2600 --screenshot=...`.
Không có `--virtual-time-budget` thì ảnh chụp trước khi fetch xong (trang trống). Khổ < ~500 px headless vẫn dựng 500 px.

## Bẫy nguồn đã biết (chép từ price-path/zone)

1. VNDirect chỉ giữ **phiên gần nhất** (tới ~09:00 hôm sau) → cron 16:00, 16:30, 18:30 và 08:15 sáng sau.
2. Phải `sort=accumulatedVol:asc`, không thì trang chồng/thiếu. Nguồn đôi khi bỏ sót tick lẻ → `shortfall()`
   nhận hụt ≤ 0,2 % và ≤ 3 chỗ, số cp hụt ghi vào `gap`.
3. `side` đặt tên theo bên **bị động**: PB = bán chủ động, PS = mua chủ động.
4. Tick là giá **thô**; quy về giá điều chỉnh lúc dựng bằng nến DNSE, không lúc lưu.
5. Chạy job trong giờ giao dịch → nguồn trả phiên dở dang; `settled()` bỏ qua (chưa có ATC / tick 14:45).
6. DGC không có trường `side` → mọi KL rơi vào ATO/ATC, cờ `no_side`.
7. Tick VN lệch về phía bán ở hầu hết mã → app đọc "so TB" (tỷ lệ mua CĐ so với 20 phiên trước của chính mã).

## Workflow

`daily.yml`: step gom `continue-on-error`, commit `if: always()`, báo đỏ sau cùng theo `steps.collect.outcome`
(bài học price-path 23/09/2026). Chạy tay: Actions → daily → Run workflow (`force` / `rebuild`).

Dung lượng: kho ≈ 340 KB/phiên (39 mã), docs intraday ≈ 950 KB/phiên (3 khung) → repo tăng ~240 MB/năm; khi quá lớn thì
thu gọn lịch sử kho (nén hoặc bỏ `lv` của nến cũ).

## Khung nến trong phiên

Kho lưu nến **5'**; job gộp thêm **15'** và **30'** (`flow/ticks.resample`) và đánh dấu hiệu riêng cho từng khung
(`intraday/<ngày>/<MÃ>.json` → `tf: {"5","15","30"}`). App mặc định **15'**, nút 5' để phóng to, 30' = kỳ Market Profile.
Lý do (đo phiên 25/09/2026): ở 5' nhiều mã có 50–80 % nến chỉ 2 mức giá — footprint không đọc được (bước giá VN
≈ 0,15 %, cả phiên chỉ ~10 bước). Ngưỡng dấu hiệu tính theo PHÚT (`FAIL_MIN`, `WARM_MIN`, `DIV_GAP_MIN`), khung 5'
cho kết quả y như bản mẫu. Tab Danh mục đếm dấu hiệu khung 15'.

## Giao diện

`docs/`: `index.html`, `app.js`, `styles.css` (bảng màu navy + vàng đồng + nâu gỗ theo ảnh mẫu), `sw.js` (chỉ cache
vỏ app, dữ liệu luôn đi mạng trước), `manifest.webmanifest`, `icons/` (`python -m scripts.make_icons`).
Đổi JS/CSS → tăng `?v=` trong index.html **và** `CACHE` trong sw.js.

Push điện thoại: chưa làm (giai đoạn sau).
