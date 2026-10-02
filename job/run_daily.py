"""Job sau phiên: danh mục KingStock → tick VNDirect → kho data/store → JSON cho giao diện docs/data.

Chạy:
    venv\\Scripts\\python -m job.run_daily            # gom phiên gần nhất (bỏ mã đã có) rồi dựng docs/data
    venv\\Scripts\\python -m job.run_daily --force    # gom lại cả mã đã có
    venv\\Scripts\\python -m job.run_daily --rebuild  # chỉ dựng lại docs/data từ kho, không gọi VNDirect
    venv\\Scripts\\python -m job.run_daily --seed     # nạp một lần dữ liệu có sẵn trên máy (xem seed())

VNDirect chỉ giữ PHIÊN GẦN NHẤT (tới ~09:00 hôm sau) → workflow chạy 16:00 + dự phòng 16:30, 18:30, 08:15 sáng sau.
Idempotent theo (mã, ngày): đã có thì không ghi lại → cron dự phòng không đẻ commit rác.

Lượt 12:05 (giờ nghỉ trưa): phiên hôm nay chưa xong → KHÔNG ghi kho (kho chỉ giữ phiên đủ), chỉ dựng bản xem sớm
docs/data/live.json + live/<MÃ>.json. Khi phiên đủ vào kho (16:00) thì bản sáng tự bị gỡ.

Mã thoát: 0 ổn · 1 có mã lỗi (ĐÃ ghi xong mọi thứ — workflow vẫn phải commit) · 2 không có danh mục.
"""
from __future__ import annotations

import argparse
import json
import logging
import shutil
import sys
from datetime import datetime
from pathlib import Path

from common import dnse, vndirect
from common.config import ROOT, SITE_DATA, STORE, TZ
from flow import daily, reading, signals
from flow.ticks import band, session_record, settled, tick_size
from job import watchlist

logger = logging.getLogger("order-flow")

TFS = (5, 15, 30)        # khung nến trong phiên; app mặc định 15'
LIST_TF = "15"           # khung dùng cho số dấu hiệu + sparkline ở tab Danh mục
KEEP_INTRADAY = 60      # số phiên giữ nến 5' trên Pages
DAILY_OUT = 40          # số phiên của file nhiều phiên mỗi mã
DNSE_DAYS = 120         # ngày lịch nến DNSE để lấy hệ số điều chỉnh (phủ ≥ 40 phiên)
SEED_TICKS = ROOT.parent / "order-flow-lab" / "ticks"
SEED_ZONE = ROOT.parent / "price-path" / "data" / "zone"
LIVE_DIR = SITE_DATA / "live"        # phiên hôm nay dở dang (lượt 12:05) — không bao giờ vào kho
LIVE_IDX = SITE_DATA / "live.json"


def dump(path: Path, obj, pretty: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    txt = json.dumps(obj, ensure_ascii=False, indent=1) if pretty else \
        json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    path.write_text(txt, encoding="utf-8")


def records(sym: str) -> list[dict]:
    d = STORE / sym
    if not d.exists():
        return []
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(d.glob("*.json"))]


def has(sym: str, day: str) -> bool:
    return (STORE / sym / f"{day}.json").exists()


# ---------------------------------------------------------------- thu thập
def collect(items: list[dict], force: bool) -> dict:
    today = datetime.now(TZ).date().isoformat()
    res = {"new": [], "have": [], "failed": {}, "unsettled": [], "partial": {}}
    with vndirect.VndirectClient() as c:
        for it in items:
            sym = it["symbol"]
            ticks = c.latest_session(sym)
            if not ticks:
                res["failed"][sym] = vndirect.last_error or "không có tick"
                continue
            day = ticks[-1]["date"]
            if not settled(ticks, today):
                res["unsettled"].append(sym)
                if day == today:  # phiên sáng: giữ trong bộ nhớ để dựng bản xem sớm, không ghi kho
                    rec = session_record(ticks)
                    rec["upto"] = ticks[-1]["time"][:5]
                    res["partial"][sym] = rec
                continue
            if has(sym, day) and not force:
                res["have"].append(sym)
                continue
            dump(STORE / sym / f"{day}.json", session_record(ticks))
            res["new"].append(sym)
            logger.info("%s %s: %s tick", sym, day, f"{len(ticks):,}")
    return res


def seed(items: list[dict]) -> None:
    """Nạp một lần (máy dev): phiên 25/09/2026 đủ tick từ order-flow-lab/ticks, và footprint ngày các phiên tick
    thật trước đó từ kho zone của price-path. Sau lần này app không đọc gì của hai thư mục đó nữa."""
    for it in items:
        sym = it["symbol"]
        for f in sorted(SEED_TICKS.glob(f"{sym}_*.json")):
            ticks = json.loads(f.read_text(encoding="utf-8"))
            if ticks and not has(sym, ticks[-1]["date"]):
                dump(STORE / sym / f"{ticks[-1]['date']}.json", session_record(ticks))
        zf = SEED_ZONE / f"{sym}.json"
        if not zf.exists():
            continue
        for day, s in json.loads(zf.read_text(encoding="utf-8"))["sessions"].items():
            if s.get("est") or has(sym, day):
                continue
            lv = sorted(([float(p), v[1], v[0], v[2], v[3], v[4]] for p, v in s["levels"].items()), reverse=True)
            rec = {"date": day, "src": "zone", "close": s["close"], "total": s["total"], "gap": s.get("gap", 0),
                   "levels": lv}
            dump(STORE / sym / f"{day}.json", rec)
    print("seed xong:", sum(1 for _ in STORE.glob("*/*.json")), "bản ghi")


# ---------------------------------------------------------------- dựng docs/data
def morning_read(rec: dict, ex: str, tfs: dict, full: bool) -> dict | None:
    """Bản đọc phiên sáng (khung 15', chỉ nến trước 11:30 → phiên đủ và lượt 12:05 cho cùng một bản đọc);
    phiên đủ thì ghép thêm buổi chiều thực tế (`out`)."""
    mb, _ = signals.analyse(reading.morning(rec["bars"]), ex, reading.TF)
    rd = reading.read_morning(mb, ex)
    if rd and full:
        rd["out"] = reading.read_outcome(rd, tfs[str(reading.TF)]["bars"], ex)
    return rd


def intraday_doc(sym: str, ex: str, rec: dict, prev: dict | None, closes: dict, full: bool = True) -> dict:
    tfs = {str(tf): dict(zip(("bars", "sigs"), signals.analyse(rec["bars"], ex, tf))) for tf in TFS}
    tot = {k: sum(b[k] for b in rec["bars"]) for k in ("buy", "sell", "x", "bb", "bs")}
    # VWAP khớp liên tục (= nến liên tục cuối), cả phiên gồm ATO/ATC, giá vốn lệnh lớn mua/bán CĐ (giá thô)
    allv = [(p, s + bu + x) for b in rec["bars"] for p, s, bu, x in b["lv"]]
    n_all = sum(n for _, n in allv)
    big = {k: (sum(b.get(k + "v", 0) for b in rec["bars"]), tot[k]) for k in ("bb", "bs")}
    has_big = all(k + "v" in b for b in rec["bars"] for k in ("bb", "bs"))  # bản ghi trước 26/09 không có
    tot["vw"] = {"cont": tfs["5"]["bars"][-1]["vw"],
                 "all": round(sum(p * n for p, n in allv) / n_all, 3) if n_all else None,
                 **{k: round(v / n, 3) if has_big and n else None for k, (v, n) in big.items()}}
    ref = cf = None
    if prev:
        # giá tham chiếu = đóng cửa phiên trước, quy về thang giá thô của phiên này (có thể có GDKHQ xen giữa)
        f_prev = daily.factor(prev["close"], closes.get(prev["date"]))
        f_now = daily.factor(rec["close"], closes.get(rec["date"]))
        ref = round(prev["close"] * f_prev / f_now, 2)
        step, bd = tick_size(ref, ex), band(ex)
        cf = [round(int(ref * (1 - bd) / step + 0.9999) * step, 2), round(int(ref * (1 + bd) / step) * step, 2)]
    return {"sym": sym, "day": rec["date"], "ex": ex, "ticks": rec["ticks"], "total": rec["total"],
            "gap": rec.get("gap", 0), "no_side": rec.get("no_side", False), "tot": tot, "ref": ref, "cf": cf,
            "tf": tfs, "read": morning_read(rec, ex, tfs, full)}


def list_row(it: dict, dl: list[dict], doc: dict | None) -> dict:
    """Một dòng tab Danh mục từ các phiên đã quy giá (dl) + file trong phiên của phiên cuối (doc)."""
    last = dl[-1]
    prev = dl[-2] if len(dl) > 1 else None
    row = {"sym": it["symbol"], "name": it.get("company_name", ""), "ex": it.get("exchange") or "HOSE",
           "day": last["d"], "close": last["close"],
           "chg": round((last["close"] / prev["close"] - 1) * 100, 2) if prev else None,
           "buy": last["buy"], "sell": last["sell"], "delta": last["delta"], "share": last["share"],
           "rel": last["rel"], "big": last["big"], "gap": last["gap"], "sig": {}, "cvd": []}
    if doc and doc["day"] == last["d"]:
        view = doc["tf"][LIST_TF]
        for s in view["sigs"]:
            row["sig"][s["kind"]] = row["sig"].get(s["kind"], 0) + 1
        row["cvd"] = [b["cvd"] for b in view["bars"] if not b["auction"]]
        row["no_side"] = doc["no_side"]
        rd = doc.get("read")
        if rd:
            out = rd.get("out") or {}
            row["read"] = {"v": rd["v"], "lean": rd["lean"], "title": rd["title"], "hit": out.get("hit"),
                           "out": out.get("txt")}
    return row


def build_live(items: list[dict], closes: dict, partial: dict | None, day: str | None,
               vols: dict | None = None) -> int:
    """Bản xem sớm phiên hôm nay dở dang. partial=None (--rebuild): giữ bản cũ nếu phiên đủ chưa vào kho.
    Có lượt gom thật mà không có phiên dở dang (16:00, 08:15…) → gỡ bản sáng."""
    if partial is None:
        if LIVE_IDX.exists() and json.loads(LIVE_IDX.read_text(encoding="utf-8"))["day"] > (day or ""):
            return 0
    shutil.rmtree(LIVE_DIR, ignore_errors=True)
    LIVE_IDX.unlink(missing_ok=True)
    rows, upto = [], []
    for it in items:
        sym, ex = it["symbol"], it.get("exchange") or "HOSE"
        rec = (partial or {}).get(sym)
        if not rec or rec["date"] <= (day or ""):
            continue
        recs, cl = records(sym), closes.get(sym, {})
        doc = intraday_doc(sym, ex, rec, recs[-1] if recs else None, cl, full=False)
        # share/rel so với TB 20 phiên ĐỦ trước đó — share là tỷ lệ nên phiên sáng so được với phiên đủ
        dl = daily.days(recs + [rec], cl, DAILY_OUT, vols=(vols or {}).get(sym))
        # dayrow = cột phiên sáng cho tab Nhiều phiên, cùng dạng daily/<MÃ>.json (CVD nối tiếp các phiên đủ)
        doc.update(partial=True, upto=rec["upto"], dayrow=dl[-1])
        dump(LIVE_DIR / f"{sym}.json", doc)
        rows.append(list_row(it, dl, doc))
        upto.append(rec["upto"])
    if rows:
        dump(LIVE_IDX, {"generated": datetime.now(TZ).isoformat(timespec="seconds"), "day": rows[0]["day"],
                        "upto": max(upto), "items": rows})
    return len(rows)


def build(items: list[dict], wl_source: str, run: dict | None) -> int:
    closes: dict[str, dict] = {}
    vols: dict[str, dict] = {}     # KL ngày DNSE → "TB20" của thẻ ★ Nhiều phiên
    with dnse.DnseClient() as c:
        for it in items:
            bars = c.bars(it["symbol"], DNSE_DAYS)
            closes[it["symbol"]] = {d: cv[0] for d, cv in bars.items()}
            vols[it["symbol"]] = {d: cv[1] for d, cv in bars.items()}

    all_days = sorted({p.stem for p in STORE.glob("*/*.json")})
    keep = set(all_days[-KEEP_INTRADAY:])
    rows, dates = [], set()
    # bản đọc sáng đúng hướng bao nhiêu lần (mọi phiên đủ đang giữ) + mốc "chiều đi tiếp hướng buổi sáng"
    stats = {"n": 0, "hit": 0, "nb": 0, "base": 0}
    for it in items:
        sym, ex = it["symbol"], it.get("exchange") or "HOSE"
        recs = records(sym)
        if not recs:
            continue
        cl = closes.get(sym, {})
        dl = daily.days(recs, cl, DAILY_OUT, vols=vols.get(sym))
        dump(SITE_DATA / "daily" / f"{sym}.json", {"sym": sym, "ex": ex, "days": dl})
        last_doc = None
        for k, rec in enumerate(recs):
            if "bars" not in rec or rec["date"] not in keep:
                continue
            doc = intraday_doc(sym, ex, rec, recs[k - 1] if k else None, cl)
            dump(SITE_DATA / "intraday" / rec["date"] / f"{sym}.json", doc)
            dates.add(rec["date"])
            last_doc = doc
            out = (doc["read"] or {}).get("out") or {}
            if out.get("hit") is not None:
                stats["n"] += 1; stats["hit"] += out["hit"]
            if out.get("base") is not None:
                stats["nb"] += 1; stats["base"] += out["base"]
        rows.append(list_row(it, dl, last_doc))

    # dọn: phiên nến 5' ngoài cửa sổ, mã đã rời danh mục
    for d in (SITE_DATA / "intraday").glob("*"):
        if d.is_dir() and d.name not in keep:
            shutil.rmtree(d)
    syms = {it["symbol"] for it in items}
    for f in (SITE_DATA / "daily").glob("*.json"):
        if f.stem not in syms:
            f.unlink()

    now = datetime.now(TZ).isoformat(timespec="seconds")
    day = max((r["day"] for r in rows), default=None)
    n_live = build_live(items, closes, run["partial"] if run else None, day, vols)
    dump(SITE_DATA / "latest.json", {"generated": now, "day": day, "dates": sorted(dates, reverse=True),
                                     "watchlist": wl_source, "read_stats": stats, "items": rows})
    state = {"run_at": now, "day": day, "symbols": len(items), "built": len(rows), "watchlist": wl_source,
             "dnse_missing": sorted(s for s, c in closes.items() if not c),
             "gaps": {r["sym"]: r["gap"] for r in rows if r["gap"] and r["day"] == day},
             "partial": n_live}
    if run is not None:
        state.update({"new": run["new"], "failed": run["failed"], "unsettled": run["unsettled"],
                      "vndirect_last_error": vndirect.last_error})
    else:
        old = SITE_DATA / "state.json"
        if old.exists():  # --rebuild: giữ nguyên kết quả gom của lần chạy thật gần nhất
            prev = json.loads(old.read_text(encoding="utf-8"))
            state.update({k: prev[k] for k in ("new", "failed", "unsettled", "vndirect_last_error") if k in prev})
    dump(SITE_DATA / "state.json", state, pretty=True)
    print(f"docs/data: {len(rows)} mã, phiên {day}, {len(dates)} phiên nến 5'" +
          (f" · phiên dở dang {n_live} mã" if n_live else ""))
    return 1 if run and run["failed"] else 0


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--seed", action="store_true")
    a = ap.parse_args(argv)
    items, src = watchlist.load()
    if not items:
        print("Không có danh mục (KingStock chết và chưa có bản chụp)")
        return 2
    print(f"Danh mục {len(items)} mã ({src})")
    if a.seed:
        seed(items)
    run = None
    if not (a.rebuild or a.seed):
        run = collect(items, a.force)
        print(f"mới {len(run['new'])} · đã có {len(run['have'])} · chưa xong phiên {len(run['unsettled'])} · "
              f"lỗi {len(run['failed'])} {' '.join(run['failed'])}")
    return build(items, src, run)


if __name__ == "__main__":
    sys.exit(main())
