"""Bản đọc phiên sáng (30/09/2026): đọc footprint khung 15' của buổi sáng thành vài câu cho người xem.

Chỉ ghép câu theo luật từ dữ liệu đã có (dấu hiệu, imbalance, cá mập theo mức giá) — không gọi AI. Luật vùng cá mập
và luật "giá chứng minh vùng" chép từ app (docs/app.js: khối FE `levels/whaleZones`, khối ★ `fpxProve`) để bản đọc
khớp với biểu đồ. Mọi bản đọc là MÔ TẢ, chưa kiểm định; phần `out` (buổi chiều thực tế) tích luỹ để đo sau.

read_morning(bars15, ex)  → {title, sub, lean, box, points[], levels[], watch}
read_outcome(rd, bars15)  → {txt, brk, atc, moves, hit, base}   (bars15 = cả phiên, cùng khung 15')
"""
from __future__ import annotations

from flow.ticks import tick_size

E = 1e-9
TF = 15
MORNING_END = "11:30"
WHALE_MIN = 50          # % cá mập phía chủ động để thành vùng cá mập (như app)
EFFORT_MIN = 0.30       # |delta| / KL chủ động của nến KL lớn nhất để kể là "dồn"
LEAN_E = 10             # điểm % delta / KL chủ động sau 30' đầu để nói "bán nhiều / mua nhiều"
FAKE_EDGE = 0.01        # ô rìa ≤ 1 % KL nến → thủng/vượt giả
MAX_POINTS = 6


# ---------------------------------------------------------------- định dạng kiểu Việt
def px(v: float) -> str:
    s = f"{v:.2f}".rstrip("0")
    s = s + "0" if s.endswith(".") else s
    return s.replace(".", ",")


def kf(v: float) -> str:
    a = abs(v)
    if a >= 1e6:
        return f"{a / 1e6:.{1 if a >= 1e7 else 2}f}M".replace(".", ",")
    if a >= 1e3:
        return f"{a / 1e3:.{0 if a >= 1e5 else 1 if a >= 1e4 else 2}f}K".replace(".", ",")
    return f"{a:.0f}"


def kfs(v: float) -> str:
    return ("+" if v > 0 else "−" if v < 0 else "") + kf(v)


def tr(v: float) -> str:
    return ("+" if v > 0 else "−" if v < 0 else "") + f"{abs(v) / 1e6:.2f}".replace(".", ",") + " tr"


def morning(raw: list[dict]) -> list[dict]:
    """Nến 5' của kho → chỉ phần buổi sáng (ATO + khớp liên tục trước 11:30)."""
    return [b for b in raw if b["t"] == "ATO" or (b["t"][:1].isdigit() and b["t"] < MORNING_END)]


# ---------------------------------------------------------------- vùng cá mập (chép app.js khối FE)
AGG = {"stack_s": "s", "absorb_b": "s", "exh_b": "s", "stack_b": "b", "absorb_s": "b", "exh_s": "b"}
NAME = {"absorb_b": "bán bị hấp thụ", "absorb_s": "mua bị hấp thụ", "exh_b": "cạn bán", "exh_s": "cạn mua",
        "stack_b": "mua xếp chồng", "stack_s": "bán xếp chồng"}


def _runs(b: dict, side: str, step: float) -> list[tuple[float, float]]:
    """Các dải imbalance cùng bên liền nhau (≥ 2 ô) của một nến."""
    ps = sorted(p for p, s in b["imb"] if s == side)
    out, run = [], []
    for p in ps:
        if run and p - run[-1] > step + E:
            if len(run) >= 2:
                out.append((run[0], run[-1]))
            run = []
        run.append(p)
    if len(run) >= 2:
        out.append((run[0], run[-1]))
    return out


def _levels(b: dict, ex: str) -> list[dict]:
    out, step = [], tick_size(b["h"], ex)
    low, high = b["lv"][-1], b["lv"][0]
    for kind in b["sig"]:
        if kind == "absorb_b":
            p = low[0] if low[1] >= .4 * b["vol"] else b["l"]
            out.append({"kind": kind, "side": "up", "lo": p, "hi": p})
        elif kind == "absorb_s":
            p = high[0] if high[2] >= .4 * b["vol"] else b["h"]
            out.append({"kind": kind, "side": "down", "lo": p, "hi": p})
        elif kind in ("stack_b", "stack_s"):
            runs = _runs(b, kind[-1], step)
            if runs:
                lo, hi = max(runs, key=lambda r: r[1] - r[0])
                out.append({"kind": kind, "side": "up" if kind == "stack_b" else "down", "lo": lo, "hi": hi})
        elif kind == "exh_b":
            out.append({"kind": kind, "side": "up", "lo": b["l"], "hi": b["l"]})
        elif kind == "exh_s":
            out.append({"kind": kind, "side": "down", "lo": b["h"], "hi": b["h"]})
    return out


def whale_zones(bars: list[dict], ex: str) -> list[dict]:
    out = []
    for k, b in enumerate(bars):
        if b["auction"]:
            continue
        for z in _levels(b, ex):
            ag = AGG[z["kind"]]
            inz = lambda p: z["lo"] - E <= p <= z["hi"] + E   # noqa: E731
            vs = sum(r[1] for r in b["lv"] if inz(r[0]))
            vb = sum(r[2] for r in b["lv"] if inz(r[0]))
            share = None
            if "blv" in b:   # như app: có trường blv (kể cả rỗng) là tính được
                ws = sum(r[1] for r in b["blv"] if inz(r[0]))
                wb = sum(r[2] for r in b["blv"] if inz(r[0]))
                av, aw = (vs, ws) if ag == "s" else (vb, wb)
                share = aw / av * 100 if av else None
            if share is not None and share >= WHALE_MIN:
                out.append({**z, "k": k, "t": b["t"], "share": share})
    return out


def prove(z: dict, bars: list[dict]) -> dict:
    """Luật ✓/✕ của thẻ ★ (fpxProve)."""
    up, touches, proofs, broke = z["side"] == "up", [], [], None
    o = bars[z["k"]]
    if (o["c"] < z["lo"] - E) if up else (o["c"] > z["hi"] + E):
        broke = z["k"]
    for i in range(z["k"] + 1, len(bars)):
        if broke is not None:
            break
        b = bars[i]
        if b["auction"]:
            if b["t"] == "ATC" and ((b["c"] < z["lo"] - E) if up else (b["c"] > z["hi"] + E)):
                broke = i
            continue
        if not ((b["l"] <= z["hi"] + E) if up else (b["h"] >= z["lo"] - E)):
            continue
        touches.append(i)
        if (b["c"] < z["lo"] - E) if up else (b["c"] > z["hi"] + E):
            broke = i
            break
        edge = b["lv"][-1] if up else b["lv"][0]
        absorbed = (edge[1] >= .4 * b["vol"] and b["l"] >= z["lo"] - E) if up else \
            (edge[2] >= .4 * b["vol"] and b["h"] <= z["hi"] + E)
        out_c = (b["c"] > z["hi"] + E) if up else (b["c"] < z["lo"] - E)
        if out_c and (((b["d"] >= 0) if up else (b["d"] <= 0)) or absorbed):
            proofs.append(i)
    return {**z, "touches": touches, "proofs": proofs, "broke": broke}


# ---------------------------------------------------------------- bản đọc buổi sáng
def read_morning(bars: list[dict], ex: str) -> dict | None:
    B = [(k, b) for k, b in enumerate(bars) if not b["auction"] and b["buy"] + b["sell"] > 0]
    if len(B) < 2:
        return None
    ato = next((b for b in bars if b["t"] == "ATO" and b.get("c")), None)
    first = B[0][1]
    open_p = ato["c"] if ato else first["o"]
    last = B[-1][1]["c"]
    step = tick_size(last, ex)
    ticks = lambda a, b: round((b - a) / step)   # noqa: E731
    moves, delta = ticks(open_p, last), sum(b["d"] for _, b in B)
    # hộp giá = biên độ sau 30' đầu (2 nến 15'); buổi sáng ngắn quá thì lấy cả buổi
    rest = B[2:] if len(B) >= 4 else B
    box_lo, box_hi = min(b["l"] for _, b in rest), max(b["h"] for _, b in rest)
    boxw = ticks(box_lo, box_hi)
    early_c = B[1][1]["c"] if len(B) >= 4 else open_p
    early = moves != 0 and abs(ticks(open_p, early_c)) >= .6 * abs(moves) and len(B) >= 4
    R = ticks(early_c, last)
    act = sum(b["buy"] + b["sell"] for _, b in rest) or 1
    Ep = sum(b["d"] for _, b in rest) / act * 100
    box = f"{px(box_lo)}–{px(box_hi)}"

    if abs(R) <= max(1, boxw // 2):
        if Ep <= -LEAN_E:
            title, lean, v = f"Giằng co trong hộp {box} · bán nhiều nhưng giá không giảm thêm", 1, "range_bid"
        elif Ep >= LEAN_E:
            title, lean, v = f"Giằng co trong hộp {box} · mua nhiều nhưng giá không tăng thêm", -1, "range_ask"
        else:
            title, lean, v = f"Giằng co trong hộp {box}", 0, "range"
    elif R > 0:
        title = "Bên mua đang giữ: giá lên theo lực mua" if Ep >= 0 else \
            "Giá lên dù bán chủ động nhiều hơn: có người mua đặt chờ đỡ"
        lean, v = 1, "up"
    else:
        title = "Bên bán đang giữ: giá xuống theo lực bán" if Ep <= 0 else \
            "Giá xuống dù mua chủ động nhiều hơn: có người bán đặt chờ chặn"
        lean, v = -1, "down"
    sub = f"Delta sáng {tr(delta)}, giá {'+' if moves > 0 else '−' if moves < 0 else ''}{abs(moves)} bước" + \
        (" (gần hết trong 30' đầu)" if early else "") + "."

    # ---- các điểm quan trọng: (ưu tiên, k, kind, câu)
    pts: list[tuple[int, int, str, str]] = []
    used = set()                                   # (k, kind) đã kể
    zones = [prove(z, bars) for z in whale_zones(bars, ex)]
    for z in zones:
        role = "sàn" if z["side"] == "up" else "trần"
        where = px(z["lo"]) if z["lo"] == z["hi"] else f"{px(z['lo'])}–{px(z['hi'])}"
        s = f"◆ {NAME[z['kind']]} ở {where}, cá mập {round(z['share'])} % → {role}"
        if z["proofs"]:
            s += f", ✓ {len(z['proofs'])} lần ({', '.join(bars[i]['t'] for i in z['proofs'])})"
        if z["broke"] is not None:
            s += f"; bị phá lúc {bars[z['broke']]['t']}"
        pts.append((3, z["k"], "whale", s))
        used.add((z["k"], z["kind"]))
        z["role"] = role
    prev_lo = prev_hi = None
    fake_k = set()
    for n, (k, b) in enumerate(B):
        # thủng/vượt giả chỉ tính sau 30' đầu (lúc đó hộp giá mới hình thành)
        if n >= 2 and prev_lo is not None and b["l"] < prev_lo - E and b["c"] >= prev_lo - E:
            edge = b["lv"][-1]
            ev = edge[1] + edge[2] + edge[3]
            if ev <= FAKE_EDGE * b["vol"]:
                pts.append((3, k, "fake", f"thủng giả {px(b['l'])} (đáy chỉ {kf(ev)} cp), đóng lại {px(b['c'])}"))
                fake_k.add(k)
        if n >= 2 and prev_hi is not None and b["h"] > prev_hi + E and b["c"] <= prev_hi + E:
            edge = b["lv"][0]
            ev = edge[1] + edge[2] + edge[3]
            if ev <= FAKE_EDGE * b["vol"]:
                pts.append((3, k, "fake", f"vượt giả {px(b['h'])} (đỉnh chỉ {kf(ev)} cp), đóng lại {px(b['c'])}"))
                fake_k.add(k)
        prev_lo = b["l"] if prev_lo is None else min(prev_lo, b["l"])
        prev_hi = b["h"] if prev_hi is None else max(prev_hi, b["h"])
    # nến KL lớn nhất: dồn một phía mà giá có đi tiếp không
    kb, bb = max(B, key=lambda x: x[1]["vol"])
    a = bb["buy"] + bb["sell"]
    if a and abs(bb["d"]) / a >= EFFORT_MIN:
        before = [b for k, b in B if k < kb]
        head = f"KL lớn nhất sáng {kf(bb['vol'])}, delta {kfs(bb['d'])}"
        if bb["d"] < 0:
            low0 = min((b["l"] for b in before), default=None)
            s = f"{head} mà không thủng {px(low0)} → bán bị hấp thụ ở đáy" if low0 is not None and bb["l"] >= low0 - E \
                else f"{head}, tạo đáy mới {px(bb['l'])} → bán có kết quả"
        else:
            high0 = max((b["h"] for b in before), default=None)
            s = f"{head} mà không vượt {px(high0)} → mua bị hấp thụ ở đỉnh" if high0 is not None and bb["h"] <= high0 + E \
                else f"{head}, tạo đỉnh mới {px(bb['h'])} → mua có kết quả"
        pts.append((3, kb, "effort", s))
    stacks = []
    for k, b in B:
        st = tick_size(b["h"], ex)
        for side in ("s", "b"):
            for lo, hi in _runs(b, side, st):
                kind = "stack_" + side
                if (k, kind) in used:
                    continue
                z = prove({"kind": kind, "side": "down" if side == "s" else "up", "lo": lo, "hi": hi, "k": k}, bars)
                if z["broke"] is not None:
                    continue          # vùng đã bị giá đóng xuyên qua trong buổi sáng: hết ý nghĩa
                role = "kháng cự trên" if side == "s" else "hỗ trợ dưới"
                pts.append((2, k, "stack", f"{'bán' if side == 's' else 'mua'} xếp chồng {px(lo)}–{px(hi)} → {role}"))
                stacks.append({"lo": lo, "hi": hi, "side": side})
    for k, b in B:
        for kind in b["sig"]:
            if kind in ("exh_b", "exh_s") and (k, kind) not in used and k not in fake_k:
                p = b["l"] if kind == "exh_b" else b["h"]
                pts.append((1, k, "exh", f"{NAME[kind]} ở {px(p)}"))
    pts = sorted(sorted(pts, key=lambda x: -x[0])[:MAX_POINTS], key=lambda x: x[1])
    points = [{"k": k, "t": bars[k]["t"], "kind": kind, "txt": f"{bars[k]['t']} · {s}"} for _, k, kind, s in pts]

    # ---- các mức cần canh
    lv: dict[float, list[str]] = {}

    def add(p: float, name: str) -> None:
        lv.setdefault(round(p, 2), []).append(name)
    add(box_hi, "trần hộp sáng")
    add(box_lo, "sàn hộp sáng")
    for z in zones:
        if z["broke"] is None:
            add(z["hi"] if z["side"] == "down" else z["lo"], f"{z['role']} cá mập ({NAME[z['kind']]} {z['t']})")
    for s in stacks:
        add(s["lo"] if s["side"] == "s" else s["hi"], f"{'bán' if s['side'] == 's' else 'mua'} xếp chồng")
    add(open_p, "giá mở cửa")
    hi_all, lo_all = max(b["h"] for _, b in B), min(b["l"] for _, b in B)
    if hi_all > box_hi + E:
        add(hi_all, "đỉnh sáng")
    if lo_all < box_lo - E:
        add(lo_all, "đáy sáng")
    vw = B[-1][1].get("vw")
    if vw:
        add(round(round(vw / step) * step, 2), f"VWAP sáng {px(round(vw, 2))}")
    levels = []
    for p in sorted(lv, reverse=True):
        where = "tren" if p > box_hi + E else "duoi" if p < box_lo - E else "hop"
        sig = "đóng trên + delta dương: bên mua thắng" if p >= box_hi - E else \
            "đóng dưới + delta âm: bên bán thắng" if p <= box_lo + E else ""
        levels.append({"p": p, "txt": " · ".join(dict.fromkeys(lv[p])), "where": where, "sig": sig})
    ups = [x["p"] for x in levels if x["where"] == "tren"][::-1][:2]
    dns = [x["p"] for x in levels if x["where"] == "duoi"][:2]
    watch = f"Canh: đóng > {px(box_hi)} + delta dương → " + (" rồi ".join(map(px, ups)) or "trên đỉnh sáng") + \
        f" · đóng < {px(box_lo)} + delta âm → " + (" rồi ".join(map(px, dns)) or "dưới đáy sáng") + "."
    return {"tf": TF, "upto": bars[-1]["t"], "open": open_p, "last": last, "moves": moves, "delta": delta,
            "box": [box_lo, box_hi], "v": v, "lean": lean, "title": title, "sub": sub, "points": points,
            "levels": levels, "watch": watch}


# ---------------------------------------------------------------- buổi chiều thực tế
def read_outcome(rd: dict, bars: list[dict], ex: str) -> dict | None:
    aft = [b for b in bars if not b["auction"] and b["t"] >= "13:00"]
    atc = next((b for b in bars if b["t"] == "ATC" and b.get("c")), None)
    if not aft and not atc:
        return None
    lo, hi = rd["box"]
    brk = next((b for b in aft if b["c"] > hi + E or b["c"] < lo - E), None)
    end = atc["c"] if atc else aft[-1]["c"]
    step = tick_size(rd["last"], ex)
    mv = round((end - rd["last"]) / step)
    pos = "trên hộp" if end > hi + E else "dưới hộp" if end < lo - E else "trong hộp"
    txt = (f"Chiều phá {'lên' if brk['c'] > hi else 'xuống'} khỏi hộp lúc {brk['t']} (đóng {px(brk['c'])})"
           if brk else "Chiều không đóng nến nào ra khỏi hộp")
    txt += f" · {'ATC' if atc else 'giá cuối'} {px(end)} {pos}, {'+' if mv > 0 else '−' if mv < 0 else ''}{abs(mv)} bước so giá cuối sáng"
    sgn = (mv > 0) - (mv < 0)
    hit = None if not rd["lean"] or not sgn else sgn == rd["lean"]
    ms = (rd["moves"] > 0) - (rd["moves"] < 0)
    base = None if not ms or not sgn else sgn == ms          # mốc: đoán "chiều đi tiếp hướng buổi sáng"
    if hit is not None:
        txt += f" → {'ĐÚNG' if hit else 'NGƯỢC'} hướng bản đọc"
    return {"txt": txt + ".", "brk": brk["t"] if brk else None, "atc": end, "moves": mv, "hit": hit, "base": base}
