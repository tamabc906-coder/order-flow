"""Nến 5' thô → delta, CVD, POC, imbalance và các dấu hiệu order flow. Chép từ order-flow-lab/build.py
(bản sửa 26/09/2026: hấp thụ theo mức giá, hấp thụ thất bại, xếp chồng 2 mức).

Chỉ là thống kê MÔ TẢ: order-flow-lab đo 16 phép trên 39 mã × 47 phiên, 0/16 qua cổng.
"""
from __future__ import annotations

import copy

from .ticks import BAR_MIN, pkey, resample, tick_size

IMB_RATIO = 3.0          # so chéo 1 bước giá
IMB_MIN_SHARE = 0.03     # bên áp đảo phải ≥ 3 % KL nến, tránh 300 cp vs 0 cũng thành imbalance
ABSORB_Q = 0.15          # delta nằm trong 15 % tệ nhất / tốt nhất phiên
ABSORB_SHARE = 0.30      # và |delta| ≥ 30 % KL khớp liên tục của nến
LVL_SHARE = 0.40         # hấp thụ tại mức giá: một bên ở một mức chiếm ≥ 40 % KL nến
LVL_MULT = 2.0           # và ≥ 2 × KL trung vị một nến trong phiên
FAIL_MIN = 30            # hấp thụ thất bại nếu giá phá mức đó trong 30 phút sau
WARM_MIN = 30            # phân kỳ/cạn kiệt chỉ xét sau 30 phút đầu phiên
DIV_GAP_MIN = 15         # đáy/đỉnh cũ phải cách ≥ 15 phút mới so phân kỳ
EXH_SHARE = 0.02         # cạn kiệt: mức giá cực trị khớp ≤ 2 % KL nến

KINDS = ("absorb_b", "absorb_s", "fail_b", "fail_s", "div_b", "div_s", "exh_b", "exh_s", "stack_b", "stack_s")


def vn(n: int) -> str:
    return f"{n:,}".replace(",", ".")


def vp(p: float) -> str:
    """64.6 → '64,6', 65.0 → '65,0', 10.05 → '10,05' (kiểu bảng giá)."""
    s = f"{p:.2f}".rstrip("0")
    return (s + "0" if s.endswith(".") else s).replace(".", ",")


def enrich(raw: list[dict], exchange: str) -> list[dict]:
    """Thêm d, cvd, vw, sd, poc, imb, vol, sig vào bản sao các nến.

    vw/sd = VWAP và độ lệch chuẩn có trọng số KL, luỹ kế từ đầu phiên tới hết nến, CHỈ khớp liên tục (ATO/ATC kéo
    lệch: ngày ETF cơ cấu ATC chiếm hơn nửa KL). Tính từ từng mức giá nên đúng như nhau ở mọi khung. ATO: None;
    ATC giữ số của nến liên tục cuối. Chỉ là bản đồ mặt bằng giá, không phải tín hiệu."""
    bars = copy.deepcopy(raw)
    cvd = 0
    pv = v = p2v = 0.0
    for b in bars:
        b["d"] = b["buy"] - b["sell"]
        cvd += b["d"]
        b["cvd"] = cvd
        if not b["auction"]:
            for p, s, bu, x in b["lv"]:
                n = s + bu + x  # x trong nến liên tục chỉ có ở mã nguồn không có bên (DGC)
                pv += p * n; v += n; p2v += p * p * n
        m = pv / v if v else None
        b["vw"] = None if m is None else round(m, 3)
        b["sd"] = None if m is None else round(max(0.0, p2v / v - m * m) ** 0.5, 3)
        step = tick_size(b["h"], exchange)
        lv = b["lv"]
        vol = sum(s + bu + x for _, s, bu, x in lv) or 1
        b["poc"] = max(lv, key=lambda r: r[1] + r[2] + r[3])[0]
        by_p = {p: (s, bu) for p, s, bu, _ in lv}
        imb = []
        for p, s, bu, _ in lv:
            dn, up = pkey(p - step), pkey(p + step)
            # Chỉ xét khi mức giá chéo nằm trong nến (mép nến không có gì để so)
            if dn in by_p and bu >= IMB_MIN_SHARE * vol and bu >= IMB_RATIO * max(by_p[dn][0], 1):
                imb.append([p, "b"])
            if up in by_p and s >= IMB_MIN_SHARE * vol and s >= IMB_RATIO * max(by_p[up][1], 1):
                imb.append([p, "s"])
        b["imb"] = imb
        b["vol"] = vol
        b["sig"] = []
    return bars


def stacks(imb: list, side: str, step: float) -> bool:
    """Có ≥ 2 ô imbalance cùng bên nằm liền nhau không."""
    ps = sorted(p for p, s in imb if s == side)
    return any(round(b - a, 3) <= step + 1e-9 for a, b in zip(ps, ps[1:]))


def mark(bars: list[dict], exchange: str, tf: int = BAR_MIN) -> list[dict]:
    """Đánh dấu hiệu lên nến (b["sig"]) và trả danh sách {i, kind, t, text} theo thứ tự thời gian.
    Ngưỡng thời gian tính theo PHÚT rồi đổi ra số nến của khung tf (5' giữ đúng số cũ: 6 / 3 / 6)."""
    warm, div_gap, fail_n = WARM_MIN // tf, max(1, DIV_GAP_MIN // tf), max(2, FAIL_MIN // tf)
    cont = [i for i, b in enumerate(bars) if not b["auction"] and b["buy"] + b["sell"] > 0]
    if len(cont) < 3:
        return []
    ds = sorted(bars[i]["d"] for i in cont)
    lo_q = ds[int(len(ds) * ABSORB_Q)]
    hi_q = ds[int(len(ds) * (1 - ABSORB_Q)) - 1]
    med_vol = sorted(bars[i]["vol"] for i in cont)[len(cont) // 2]
    sigs: list[dict] = []
    walls = []   # (chỉ số nến, "b"/"s", mức giá) — mức hấp thụ để soát thất bại
    seen = set()  # vùng xếp chồng đã báo

    def add(i, kind, text):
        bars[i]["sig"].append(kind)
        sigs.append({"i": i, "kind": kind, "t": bars[i]["t"], "text": text})

    run_lo = run_hi = None  # (giá, cvd, chỉ số nến) của đáy/đỉnh phiên tới giờ
    for n, i in enumerate(cont):
        b = bars[i]
        rng = b["h"] - b["l"]
        mid = (b["h"] + b["l"]) / 2
        step = tick_size(b["h"], exchange)

        # Hấp thụ theo mức giá: bán dồn vào đúng đáy nến (mua dồn vào đúng đỉnh nến) mà giá không đi tiếp
        low_row, high_row = b["lv"][-1], b["lv"][0]
        big = LVL_MULT * med_vol
        lvl_b = rng > 0 and low_row[1] >= LVL_SHARE * b["vol"] and low_row[1] >= big
        lvl_s = rng > 0 and high_row[2] >= LVL_SHARE * b["vol"] and high_row[2] >= big
        if lvl_b:
            add(i, "absorb_b", f"Bán chủ động dồn {vn(low_row[1])} cp ({round(low_row[1] / b['vol'] * 100)} % KL nến) "
                               f"vào đúng mức {vp(low_row[0])} mà giá không xuống thấp hơn: có người mua đặt chờ ở đó.")
            walls.append((i, "b", low_row[0]))
        if lvl_s:
            add(i, "absorb_s", f"Mua chủ động dồn {vn(high_row[2])} cp ({round(high_row[2] / b['vol'] * 100)} % KL nến) "
                               f"vào đúng mức {vp(high_row[0])} mà giá không lên cao hơn: có người bán đặt chờ ở đó.")
            walls.append((i, "s", high_row[0]))

        # Hấp thụ theo delta: delta mạnh một chiều mà giá đóng hẳn ở nửa ngược lại (đóng đúng giữa thân không tính)
        strong = abs(b["d"]) >= ABSORB_SHARE * (b["buy"] + b["sell"])
        if not lvl_b and strong and b["d"] <= lo_q and b["d"] < 0 and rng > 0 and b["c"] > mid:
            add(i, "absorb_b", f"Bán chủ động {vn(-b['d'])} cp ròng nhưng giá đóng ở nửa trên nến: có người mua "
                               f"đặt chờ nuốt hết lệnh bán.")
            walls.append((i, "b", b["l"]))
        if not lvl_s and strong and b["d"] >= hi_q and b["d"] > 0 and rng > 0 and b["c"] < mid:
            add(i, "absorb_s", f"Mua chủ động {vn(b['d'])} cp ròng nhưng giá đóng ở nửa dưới nến: có người bán "
                               f"đặt chờ chặn phía trên.")
            walls.append((i, "s", b["h"]))

        # Imbalance xếp chồng: ≥ 2 mức liền nhau cùng một bên (bước giá VN thô, 3 mức gần như không có).
        # Bỏ nến có cả hai bên (tự triệt nhau) và vùng đã báo trước đó trong phiên.
        sides = [sd for sd in ("b", "s") if stacks(b["imb"], sd, step)]
        for side in sides if len(sides) == 1 else []:
            ps = sorted(p for p, s in b["imb"] if s == side)
            run = [ps[0]]
            for p in ps[1:] + [None]:
                if p is not None and round(p - run[-1], 3) <= step + 1e-9:
                    run.append(p)
                    continue
                if len(run) >= 2 and (side, run[0], run[-1]) not in seen:
                    seen.add((side, run[0], run[-1]))
                    zone = f"{vp(run[0])}–{vp(run[-1])}"
                    add(i, "stack_" + side,
                        f"{len(run)} ô imbalance {'mua' if side == 'b' else 'bán'} liền nhau tại {zone}: "
                        f"vùng này thường thành {'hỗ trợ' if side == 'b' else 'kháng cự'} cho các nến sau.")
                run = [p] if p is not None else []

        if run_lo and b["l"] < run_lo[0] and n >= warm and i - run_lo[2] >= div_gap and b["cvd"] > run_lo[1]:
            add(i, "div_b", f"Giá thủng đáy phiên ({vp(run_lo[0])} → {vp(b['l'])}) nhưng CVD cao hơn lúc tạo đáy cũ "
                            f"({vn(run_lo[1])} → {vn(b['cvd'])}): lực bán chủ động yếu dần.")
        if run_hi and b["h"] > run_hi[0] and n >= warm and i - run_hi[2] >= div_gap and b["cvd"] < run_hi[1]:
            add(i, "div_s", f"Giá vượt đỉnh phiên ({vp(run_hi[0])} → {vp(b['h'])}) nhưng CVD thấp hơn lúc tạo đỉnh cũ "
                            f"({vn(run_hi[1])} → {vn(b['cvd'])}): đỉnh mới được đẩy bằng ít tiền mua chủ động.")
        new_lo = run_lo is None or b["l"] < run_lo[0]
        new_hi = run_hi is None or b["h"] > run_hi[0]
        if n >= warm and (new_lo or new_hi) and rng > 0:
            edge = b["lv"][-1] if new_lo else b["lv"][0]
            edge_vol = edge[1] + edge[2]
            if edge_vol <= EXH_SHARE * b["vol"]:
                add(i, "exh_b" if new_lo else "exh_s",
                    f"Nến tạo {'đáy' if new_lo else 'đỉnh'} phiên mới tại {vp(edge[0])} nhưng ở mức giá đó "
                    f"chỉ khớp {vn(edge_vol)} cp ({vp(round(edge_vol / b['vol'] * 100, 1))} % KL nến): hết người đuổi.")
        if new_lo:
            run_lo = (b["l"], b["cvd"], i)
        if new_hi:
            run_hi = (b["h"], b["cvd"], i)

    # Hấp thụ thất bại: trong FAIL_MIN phút sau, giá phá qua mức đã hấp thụ ≥ 1 bước giá
    pos = {i: n for n, i in enumerate(cont)}
    for i, side, p in walls:
        step = tick_size(p, exchange)
        for j in cont[pos[i] + 1: pos[i] + 1 + fail_n]:
            broke = bars[j]["l"] <= p - step + 1e-9 if side == "b" else bars[j]["h"] >= p + step - 1e-9
            if broke:
                edge = bars[j]["l"] if side == "b" else bars[j]["h"]
                add(j, "fail_" + side,
                    f"Giá {'thủng' if side == 'b' else 'vượt'} mức hấp thụ {vp(p)} của nến {bars[i]['t']} "
                    f"(tới {vp(edge)}): bên {'mua' if side == 'b' else 'bán'} đặt chờ đã thua, "
                    f"xu hướng {'giảm' if side == 'b' else 'tăng'} dễ đi tiếp.")
                break
    sigs.sort(key=lambda s: s["i"])
    return sigs


def analyse(raw: list[dict], exchange: str, tf: int = BAR_MIN) -> tuple[list[dict], list[dict]]:
    """raw = nến 5' của kho; tf = khung muốn xem (5, 15, 30)."""
    bars = enrich(resample(raw, tf), exchange)
    return bars, mark(bars, exchange, tf)
