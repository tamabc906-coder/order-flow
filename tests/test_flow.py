"""Chạy: venv\\Scripts\\python -m pytest -q

Phiên FPT 25/09/2026 là phiên vàng — số đã đối chiếu tay với order-flow-lab (trang mẫu người dùng duyệt 26/09).
"""
import json
from pathlib import Path

import pytest

from common.vndirect import shortfall
from flow import daily, signals
from flow.ticks import orders, session_record, settled, tick_size

STORE = Path(__file__).resolve().parent.parent / "data" / "store"
FPT = STORE / "FPT" / "2026-09-25.json"


def tk(time, price, vol, side, acc, date="2026-09-25"):
    return {"date": date, "time": time, "price": price, "vol": vol, "side": side, "acc": acc}


def test_side_is_read_reversed():
    # PS (passive sell) = MUA chủ động, PB = BÁN chủ động
    rec = session_record([tk("09:20:01", 10.0, 100, "PS", 100), tk("09:20:02", 10.0, 300, "PB", 400)])
    bar = rec["bars"][0]
    assert (bar["buy"], bar["sell"]) == (100, 300)
    assert bar["lv"] == [[10.0, 300, 100, 0]]


def test_orders_merge_same_second_price_side():
    t = [tk("09:30:00", 20.0, 500, "PS", 500), tk("09:30:00", 20.0, 700, "PS", 1200),
         tk("09:30:00", 20.0, 100, "PB", 1300)]
    assert [o["vol"] for o in orders(t)] == [1200, 100]


def test_big_order_threshold_after_merge():
    # 2 tick × 10.000 cp × 30 nghìn = 600 tr đ sau khi gộp → lệnh lớn; tách riêng thì từng tick chỉ 300 tr
    t = [tk("10:00:00", 30.0, 10000, "PS", 10000), tk("10:00:00", 30.0, 10000, "PS", 20000)]
    assert session_record(t)["bars"][0]["bb"] == 20000


def test_auction_goes_to_x():
    rec = session_record([tk("09:15:00", 10.0, 1000, "ATO", 1000), tk("09:16:00", 10.0, 100, "PS", 1100),
                          tk("14:45:00", 10.1, 2000, "ATC", 3100)])
    assert [b["t"] for b in rec["bars"]] == ["ATO", "09:15", "ATC"]
    assert rec["bars"][0]["x"] == 1000 and rec["bars"][-1]["x"] == 2000


def test_settled():
    assert not settled([tk("11:20:00", 10.0, 100, "PS", 100)], "2026-09-25")
    assert settled([tk("11:20:00", 10.0, 100, "PS", 100)], "2026-09-26")
    assert settled([tk("14:45:00", 10.0, 100, "ATC", 100)], "2026-09-25")


def test_tick_size_by_exchange():
    assert tick_size(65, "HOSE") == 0.1 and tick_size(25, "HOSE") == 0.05 and tick_size(8, "HOSE") == 0.01
    assert tick_size(15, "HNX") == 0.1 and tick_size(8, "UPCOM") == 0.1


def test_shortfall_tolerates_single_missing_tick():
    t = [tk("09:20:00", 10.0, 100, "PS", 100), tk("09:20:01", 10.0, 100, "PS", 700)]  # hụt 500 cp tại 1 chỗ
    assert shortfall(t) is None  # 500/700 > 0,2 %
    big = [tk("09:20:00", 10.0, 1_000_000, "PS", 1_000_000), tk("09:20:01", 10.0, 100, "PS", 1_000_600)]
    assert shortfall(big) == 500


def test_factor_and_rel():
    assert daily.factor(71.7, 65.18) == pytest.approx(0.9091, abs=1e-4)
    assert daily.factor(64.7, 64.72) == 1.0
    recs = [{"date": f"2026-09-2{i}", "close": 10.0, "gap": 0,
             "levels": [[10.0, s, b, 0, 0, 0]]} for i, (s, b) in enumerate([(60, 40), (60, 40), (80, 20)])]
    out = daily.days(recs, {})
    assert [r["share"] for r in out] == [40.0, 40.0, 20.0]
    assert out[0]["rel"] is None and out[2]["rel"] == -20.0
    assert out[2]["cvd"] == -100


@pytest.mark.skipif(not FPT.exists(), reason="chưa seed kho")
def test_fpt_golden_session():
    rec = json.loads(FPT.read_text(encoding="utf-8"))
    bars, sigs = signals.analyse(rec["bars"], "HOSE")
    assert sum(b["buy"] for b in bars) == 1_001_700
    assert sum(b["sell"] for b in bars) == 2_336_200
    assert bars[-1]["cvd"] == -1_334_500
    got = {(s["t"], s["kind"]) for s in sigs}
    # 13:05 bán 353.100 cp vào đúng 65,0 → hấp thụ; bị phá ngay nến 13:10; 14:00 → 14:05 lặp lại; đáy 64,6 cạn kiệt
    for want in [("13:05", "absorb_b"), ("13:10", "fail_b"), ("14:00", "absorb_b"), ("14:05", "fail_b"),
                 ("14:05", "exh_b")]:
        assert want in got
    # nến đóng đúng giữa thân không còn bị gắn cờ hấp thụ
    assert ("10:30", "absorb_s") not in got and ("13:30", "absorb_s") not in got
    assert len(sigs) == 13
