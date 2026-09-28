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


@pytest.mark.skipif(not FPT.exists(), reason="chưa seed kho")
@pytest.mark.parametrize("tf,n_cont", [(15, 15), (30, 8)])
def test_resample_preserves_volume(tf, n_cont):
    from flow.ticks import resample
    rec = json.loads(FPT.read_text(encoding="utf-8"))
    bars = resample(rec["bars"], tf)
    assert [b["t"] for b in bars if b["auction"]] == ["ATO", "ATC"]
    assert sum(1 for b in bars if not b["auction"]) == n_cont
    for k in ("buy", "sell", "x", "bb", "bs"):
        assert sum(b[k] for b in bars) == sum(b[k] for b in rec["bars"])
    for b in bars:  # Σ từng mức giá = tổng của nến
        assert sum(r[1] for r in b["lv"]) == b["sell"] and sum(r[2] for r in b["lv"]) == b["buy"]
    # nến chiều đầu tiên bắt đầu đúng 13:00, không dính nến 11:25
    assert "13:00" in [b["t"] for b in bars]


@pytest.mark.skipif(not FPT.exists(), reason="chưa seed kho")
def test_fpt_15m_reads_break_not_absorption():
    # Ở 15', nến 13:00–13:15 đã thủng 65,0 xuống 64,8 → không còn "hấp thụ" mà là imbalance bán xếp chồng
    rec = json.loads(FPT.read_text(encoding="utf-8"))
    bars, sigs = signals.analyse(rec["bars"], "HOSE", 15)
    got = {(s["t"], s["kind"]) for s in sigs}
    assert ("13:00", "stack_s") in got and not any(k == "absorb_b" and t == "13:00" for t, k in got)


@pytest.mark.skipif(not FPT.exists(), reason="chưa seed kho")
def test_fpt_vwap_same_across_timeframes():
    # VWAP khớp liên tục FPT 25/09 = 65,046 (order-flow-lab tính từ tick, trùng kho zone); nến 09:15 = 65,357 (tính tay)
    rec = json.loads(FPT.read_text(encoding="utf-8"))
    last = {}
    for tf in (5, 15, 30):
        bars, _ = signals.analyse(rec["bars"], "HOSE", tf)
        assert bars[0]["t"] == "ATO" and bars[0]["vw"] is None
        assert bars[-1]["t"] == "ATC" and bars[-1]["vw"] == bars[-2]["vw"]
        last[tf] = bars[-1]["vw"]
        if tf == 5:
            assert bars[1]["vw"] == pytest.approx(65.357, abs=1e-3)
    assert last[5] == last[15] == last[30] == pytest.approx(65.046, abs=1e-3)


@pytest.mark.skipif(not FPT.exists(), reason="chưa seed kho")
def test_big_order_value_and_daily_vwap():
    rec = json.loads(FPT.read_text(encoding="utf-8"))
    bb = sum(b["bb"] for b in rec["bars"]); bbv = sum(b["bbv"] for b in rec["bars"])
    assert bbv / bb == pytest.approx(65.13, abs=0.01)   # giá vốn lệnh lớn mua CĐ, khớp order-flow-lab
    d = daily.days([rec], {})[-1]
    assert d["vw"] == pytest.approx(65.046, abs=1e-3) and d["vwv"] == 1_001_700 + 2_336_200


# ---------------------------------------------------------------- footprint cá mập (27/09/2026)
def test_big_orders_split_by_price_level():
    # 20.000 cp × 30 = 600 tr (lớn, mua) · 20.000 cp × 29,9 bán chủ động = 598 tr (lớn, bán) · 100 cp mua (nhỏ)
    t = [tk("10:00:00", 30.0, 20000, "PS", 20000), tk("10:00:05", 29.9, 20000, "PB", 40000),
         tk("10:00:09", 30.0, 100, "PS", 40100)]
    bar = session_record(t)["bars"][0]
    assert bar["blv"] == [[30.0, 0, 20000], [29.9, 20000, 0]]          # [giá, bán_lớn, mua_lớn]
    assert sum(r[2] for r in bar["blv"]) == bar["bb"] and sum(r[1] for r in bar["blv"]) == bar["bs"]


def test_fpt_blv_matches_totals_and_survives_resample():
    rec = json.loads(FPT.read_text(encoding="utf-8"))
    for b in rec["bars"]:
        assert sum(r[2] for r in b["blv"]) == b["bb"] and sum(r[1] for r in b["blv"]) == b["bs"]
    from flow.ticks import resample
    m30 = [b for b in resample(rec["bars"], 30) if not b["auction"]]
    assert sum(r[2] for b in m30 for r in b["blv"]) == sum(b["bb"] for b in rec["bars"])


def test_days_whale_footprint_from_zone_and_ticks():
    zone = {"date": "2026-09-24", "src": "zone", "close": 10.0, "total": 900,
            "levels": [[10.1, 100, 300, 0, 200, 0], [10.0, 400, 100, 0, 0, 300]]}   # [giá, bán, mua, x, mua_lớn, bán_lớn]
    tick = session_record([tk("10:00:00", 25.0, 30000, "PS", 30000, "2026-09-25")])
    tick.update(date="2026-09-25")
    old = json.loads(json.dumps(tick)); [b.pop("blv") for b in old["bars"]]     # bản ghi trước 27/09 chưa có blv
    d = daily.days([zone, tick], {})
    assert d[0]["blv"] == [[10.1, 0, 200], [10.0, 300, 0]] and d[0]["blv_ok"]
    assert d[1]["blv"] == [[25.0, 0, 30000]] and (d[1]["bb"], d[1]["bs"]) == (30000, 0)
    o = daily.days([old], {})[0]
    assert o["blv_ok"] is False and o["blv"] == []


# ---------------------------------------------------------------- lượt 12:05: phiên dở dang
@pytest.fixture
def job_dirs(tmp_path, monkeypatch):
    from job import run_daily as rd
    site = tmp_path / "site"
    monkeypatch.setattr(rd, "STORE", tmp_path / "store")
    monkeypatch.setattr(rd, "LIVE_DIR", site / "live")
    monkeypatch.setattr(rd, "LIVE_IDX", site / "live.json")
    return rd


def morning(date):
    return [tk("09:15:00", 10.0, 1000, "ATO", 1000, date), tk("10:00:00", 10.1, 500, "PS", 1500, date),
            tk("11:29:40", 10.0, 300, "PB", 1800, date)]


def test_collect_keeps_morning_out_of_store(job_dirs, monkeypatch):
    rd = job_dirs
    today = rd.datetime.now(rd.TZ).date().isoformat()

    class Fake:
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def latest_session(self, sym): return morning(today)

    monkeypatch.setattr(rd.vndirect, "VndirectClient", Fake)
    res = rd.collect([{"symbol": "AAA"}], force=False)
    assert res["unsettled"] == ["AAA"] and res["partial"]["AAA"]["upto"] == "11:29"
    assert not rd.STORE.exists()


def test_live_built_then_removed_when_full_session_lands(job_dirs):
    rd = job_dirs
    items = [{"symbol": "AAA", "exchange": "HOSE"}]
    rd.dump(rd.STORE / "AAA" / "2026-09-25.json", session_record(morning("2026-09-25")))
    rec = session_record(morning("2026-09-28"))
    rec["upto"] = "11:29"
    assert rd.build_live(items, {}, {"AAA": rec}, "2026-09-25") == 1
    idx = json.loads(rd.LIVE_IDX.read_text(encoding="utf-8"))
    assert idx["day"] == "2026-09-28" and idx["upto"] == "11:29" and idx["items"][0]["delta"] == 200
    doc = json.loads((rd.LIVE_DIR / "AAA.json").read_text(encoding="utf-8"))
    assert doc["partial"] and doc["ref"] == 10.0
    assert doc["dayrow"]["d"] == "2026-09-28" and doc["dayrow"]["cvd"] == 400   # nối tiếp phiên 25/09 (+200 + 200)
    assert rd.build_live(items, {}, None, "2026-09-25") == 0 and rd.LIVE_IDX.exists()   # --rebuild giữa trưa: giữ
    assert rd.build_live(items, {}, {}, "2026-09-28") == 0                               # 16:00: phiên đủ đã vào kho
    assert not rd.LIVE_IDX.exists() and not rd.LIVE_DIR.exists()
