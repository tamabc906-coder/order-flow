"""Tổng hợp theo phiên: footprint ngày, delta, CVD nhiều phiên, tỷ lệ mua chủ động so với chính mã đó.

Kho có hai loại bản ghi:
- phiên đủ tick (`bars`): gộp từ nến 5';
- phiên chỉ có footprint ngày (`levels`, src "zone"): 18–24/09/2026 nạp một lần từ kho zone của price-path,
  mỗi dòng [giá, bán, mua, x, mua_lớn, bán_lớn].
Tick là giá THÔ; nhiều phiên phải quy về thang giá điều chỉnh bằng nến ngày DNSE lúc dựng, không lúc lưu.
"""
from __future__ import annotations

REL_N = 20              # "so TB": tỷ lệ mua chủ động so với trung bình tối đa 20 phiên trước
FACTOR_NOISE = 0.005    # lệch < 0,5 % coi như không có sự kiện điều chỉnh


def summary(rec: dict) -> dict:
    """Bản ghi kho → {levels: {giá: [bán, mua, x]}, big: {giá: [bán_lớn, mua_lớn]} | None, buy, sell, x, bb, bs}.
    big = footprint cá mập theo mức giá; None khi bản ghi tick cũ (trước 27/09/2026) chưa lưu `blv`."""
    levels: dict[float, list[int]] = {}
    big: dict[float, list[int]] | None = {}
    if "bars" in rec:
        bb = bs = 0
        for b in rec["bars"]:
            bb += b["bb"]; bs += b["bs"]
            for p, s, bu, x in b["lv"]:
                row = levels.setdefault(p, [0, 0, 0])
                row[0] += s; row[1] += bu; row[2] += x
            if big is not None and "blv" not in b and (b["bb"] or b["bs"]):
                big = None
            if big is not None:
                for p, s, bu in b.get("blv", []):
                    row = big.setdefault(p, [0, 0])
                    row[0] += s; row[1] += bu
    else:
        bb = sum(r[4] for r in rec["levels"])
        bs = sum(r[5] for r in rec["levels"])
        for p, s, bu, x, b_buy, b_sell in rec["levels"]:
            levels[p] = [s, bu, x]
            if b_buy or b_sell:
                big[p] = [b_sell, b_buy]
    return {"levels": levels, "big": big, "buy": sum(r[1] for r in levels.values()),
            "sell": sum(r[0] for r in levels.values()), "x": sum(r[2] for r in levels.values()), "bb": bb, "bs": bs}


def factor(raw_close: float, adj_close: float | None) -> float:
    """Hệ số nhân vào giá thô để về thang điều chỉnh hiện hành. Không có nến DNSE → 1."""
    if not adj_close or raw_close <= 0:
        return 1.0
    f = adj_close / raw_close
    return 1.0 if abs(f - 1) < FACTOR_NOISE else f


def days(recs: list[dict], closes: dict[str, float], n_out: int = 40) -> list[dict]:
    """Các phiên (cũ → mới) đã quy giá điều chỉnh; trả n_out phiên cuối. CVD cộng dồn từ phiên đầu kho."""
    out, cvd, shares = [], 0, []
    for rec in recs:
        sm = summary(rec)
        f = factor(rec["close"], closes.get(rec["date"]))
        buy, sell = sm["buy"], sm["sell"]
        cvd += buy - sell
        share = buy / (buy + sell) if buy + sell else None
        prev = [x for x in shares[-REL_N:] if x is not None]
        rel = round((share - sum(prev) / len(prev)) * 100, 1) if share is not None and prev else None
        shares.append(share)
        lv = sorted(([round(p * f, 2), *r] for p, r in sm["levels"].items()), reverse=True)
        blv = None if sm["big"] is None else sorted(([round(p * f, 2), *r] for p, r in sm["big"].items()), reverse=True)
        # VWAP phiên = khớp liên tục (mua + bán CĐ); mã không có bên CĐ thì đành gồm cả ATO/ATC.
        # vwv = KL dùng để tính → giao diện cộng dồn nhiều phiên thành AVWAP.
        w = [(p, s + bu if buy + sell else s + bu + x) for p, s, bu, x in lv]
        vwv = sum(n for _, n in w)
        vw = sum(p * n for p, n in w) / vwv if vwv else None
        # o = giá mở cửa (nến đầu = ATO) cho biểu đồ footprint cả phiên; bản ghi cũ chỉ có levels → None
        o = round(rec["bars"][0]["o"] * f, 2) if rec.get("bars") else None
        out.append({"d": rec["date"], "o": o, "close": round(rec["close"] * f, 2), "raw": rec["close"], "f": round(f, 4),
                    "buy": buy, "sell": sell, "x": sm["x"], "delta": buy - sell, "cvd": cvd,
                    "share": None if share is None else round(share * 100, 1), "rel": rel,
                    "big": sm["bb"] - sm["bs"], "gap": rec.get("gap", 0), "intraday": "bars" in rec,
                    "vw": None if vw is None else round(vw, 3), "vwv": vwv,
                    "cvw": round((rec["close"] * f / vw - 1) * 100, 2) if vw else None, "lv": lv,
                    "bb": sm["bb"], "bs": sm["bs"], "blv": blv or [], "blv_ok": blv is not None})
    return out[-n_out:]
