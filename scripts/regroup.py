"""Dựng lại bản ghi kho từ tick thô đã lưu, theo cách gộp lệnh quét mới (flow/ticks.sweeps, 05/10/2026).

    venv\\Scripts\\python -m scripts.regroup THƯ_MỤC_TICK

Thư mục: <ngày>/<MÃ>.json.gz dạng {"ticks": [[hh:mm:ss, giá, KL, side, luỹ kế], ...]} — Release `t<ngày>` của
order-flow-live (tick gốc VNDirect, lưu mãi). Chỉ thay bản ghi tick thật đã có trong data/store và chỉ khi tổng KL
khớp đúng; lệch thì giữ bản cũ và in ra. Xong chạy `python -m job.run_daily --rebuild`.
"""
from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path

from flow.ticks import session_record
from job.run_daily import STORE, dump


def main() -> None:
    root = Path(sys.argv[1])
    changed = same = kept = 0
    for d in sorted(p for p in root.iterdir() if p.is_dir()):
        for path in sorted(STORE.glob(f"*/{d.name}.json")):
            sym = path.parent.name
            f = d / f"{sym}.json.gz"
            old = json.loads(path.read_text(encoding="utf-8"))
            if not f.exists() or "bars" not in old:
                continue
            rows = json.load(gzip.open(f))["ticks"]
            ticks = [{"date": d.name, "time": t, "price": p, "vol": v, "side": s, "acc": a} for t, p, v, s, a in rows]
            new = session_record(ticks)
            if new["total"] != old["total"]:
                print(f"{sym} {d.name}: tổng KL lệch ({old['total']:,} vs {new['total']:,}) — giữ bản cũ")
                kept += 1
                continue
            if new["bars"] == old["bars"]:
                same += 1
                continue
            ob = sum(b["bbv"] for b in old["bars"]) / 1e6
            nb = sum(b["bbv"] for b in new["bars"]) / 1e6
            os_ = sum(b["bsv"] for b in old["bars"]) / 1e6
            ns = sum(b["bsv"] for b in new["bars"]) / 1e6
            dump(path, new)
            changed += 1
            if sym in ("STB", "PLX", "TCB"):
                print(f"{sym} {d.name}: CM mua {ob:.2f} → {nb:.2f} tỷ, bán {os_:.2f} → {ns:.2f} tỷ")
    print(f"đổi {changed}, không đổi {same}, giữ vì lệch {kept}")


if __name__ == "__main__":
    main()
