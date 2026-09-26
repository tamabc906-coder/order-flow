"""Nến ngày DNSE/Entrade (giá đã điều chỉnh cổ tức, nghìn đồng) — chỉ để quy giá thô của tick về thang
điều chỉnh khi vẽ nhiều phiên. Rút gọn từ price-path/common/dnse.py.

Endpoint: GET {DNSE_BASE}/stock?symbol=FPT&resolution=1D&from=<epoch>&to=<epoch>
Trả {"t":[...],"o":[...],"h":[...],"l":[...],"c":[...],"v":[...]}.
Nghỉ 0,3 s giữa các lần gọi; lỗi → {} + last_error, không ném ra ngoài.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta

import httpx

from .config import BROWSER_HEADERS, DNSE_BASE, HTTP_TIMEOUT, TZ

logger = logging.getLogger(__name__)

THROTTLE_SECONDS = 0.3
last_error: str = ""


class DnseClient:
    def __init__(self):
        self._client = httpx.Client(timeout=HTTP_TIMEOUT, headers=BROWSER_HEADERS)
        self._last_call = 0.0

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self._client.close()

    def closes(self, symbol: str, days: int) -> dict[str, float]:
        """{ngày ISO: giá đóng cửa điều chỉnh} cho `days` ngày lịch gần nhất."""
        global last_error
        wait = THROTTLE_SECONDS - (time.monotonic() - self._last_call)
        if wait > 0:
            time.sleep(wait)
        now = datetime.now(TZ)
        params = {"symbol": symbol.upper(), "resolution": "1D",
                  "from": int((now - timedelta(days=days)).timestamp()),
                  "to": int((now + timedelta(days=1)).timestamp())}
        try:
            r = self._client.get(f"{DNSE_BASE}/stock", params=params)
            self._last_call = time.monotonic()
            r.raise_for_status()
            p = r.json()
            out = {datetime.fromtimestamp(t, TZ).date().isoformat(): float(c)
                   for t, c in zip(p.get("t") or [], p.get("c") or [])}
        except Exception as exc:  # noqa: BLE001 — một mã hỏng không được làm chết cả vòng
            self._last_call = time.monotonic()
            last_error = f"{symbol}: {exc}"
            logger.warning("DNSE lỗi %s: %s", symbol, exc)
            return {}
        return out
