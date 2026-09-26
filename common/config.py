"""Cấu hình chung. Chép phần cần của price-path/common/config.py — app này không phụ thuộc price-path."""
from __future__ import annotations

import os
from datetime import timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Kho gốc: mỗi phiên một file, giữ mãi — từ đây dựng lại được mọi thứ trong docs/data.
STORE = ROOT / "data" / "store"
# JSON giao diện đọc — nằm trong docs/ vì GitHub Pages phục vụ thư mục /docs.
SITE_DATA = ROOT / "docs" / "data"

# Offset cố định +7: VN không có giờ mùa hè, Windows mặc định thiếu bộ tzdata.
TZ = timezone(timedelta(hours=7), name="Asia/Ho_Chi_Minh")

HTTP_TIMEOUT = float(os.getenv("HTTP_TIMEOUT", "30"))
DNSE_BASE = os.getenv("DNSE_BASE", "https://services.entrade.com.vn/chart-api/v2/ohlcs")

# Danh mục lấy từ KingStock (app cảnh báo Stochastic trên Fly). API không có CORS nên trình duyệt không
# gọi thẳng được — job lấy và ghi bản chụp docs/data/watchlist.json; Fly chết thì dùng bản chụp.
KINGSTOCK_WATCHLIST = os.getenv("KINGSTOCK_WATCHLIST", "https://kingstock-deptlink.fly.dev/api/watchlist")

# Header giả trình duyệt — một số nguồn có WAF chặn UA lạ.
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
}
