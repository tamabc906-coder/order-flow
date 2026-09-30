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


def value_area(B: list[tuple[int, dict]], share: float = .7) -> tuple:
    """Vùng giá trị (70 % KL khớp liên tục) + POC của các nến B, nở dần từ POC về phía có KL lớn hơn."""
    vol: dict[float, int] = {}
    for _, b in B:
        for p, s, bu, _x in b["lv"]:
            vol[p] = vol.get(p, 0) + s + bu
    vol = {p: v for p, v in vol.items() if v > 0}
    if not vol:
        return None, None, None
    ps = sorted(vol)
    poc = max(ps, key=lambda p: vol[p])
    i = j = ps.index(poc)
    acc, tot = vol[poc], sum(vol.values())
    while acc < share * tot:
        up = vol[ps[j + 1]] if j + 1 < len(ps) else -1
        dn = vol[ps[i - 1]] if i > 0 else -1
        if up >= dn:
            j += 1; acc += up
        else:
            i -= 1; acc += dn
    return ps[i], ps[j], poc


def _tag(kind: str, s: str) -> dict:
    """Nhãn ngắn + hướng nghiêng (+1 mua, −1 bán) của một điểm, cho bảng tổng hợp dấu hiệu."""
    if kind == "whale":
        broke = "bị phá" in s
        if "→ sàn" in s:
            return {"tag": "Sàn cá mập" + (" (đã vỡ)" if broke else ""), "dir": -1 if broke else 1}
        return {"tag": "Trần cá mập" + (" (đã vỡ)" if broke else ""), "dir": 1 if broke else -1}
    if kind == "fake":
        return {"tag": "Thủng giả: bên mua đỡ", "dir": 1} if s.startswith("thủng") else \
            {"tag": "Vượt giả: bên bán chặn", "dir": -1}
    if kind == "effort":
        if "bán bị hấp thụ" in s:
            return {"tag": "Bán dồn bị hấp thụ", "dir": 1}
        if "mua bị hấp thụ" in s:
            return {"tag": "Mua dồn bị hấp thụ", "dir": -1}
        return {"tag": "Bán dồn có kết quả", "dir": -1} if "bán có kết quả" in s else {"tag": "Mua dồn có kết quả", "dir": 1}
    if kind == "stack":
        return {"tag": "Kháng cự xếp chồng", "dir": -1} if s.startswith("bán") else {"tag": "Hỗ trợ xếp chồng", "dir": 1}
    if kind == "exh":
        return {"tag": "Cạn bán: hết đà giảm", "dir": 1} if s.startswith("cạn bán") else {"tag": "Cạn mua: hết đà tăng", "dir": -1}
    if kind == "div_b":
        return {"tag": "Bán yếu dần", "dir": 1}
    if kind == "div_s":
        return {"tag": "Mua yếu dần", "dir": -1}
    return {"tag": kind, "dir": 0}


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

    # ---- các điểm quan trọng: (ưu tiên, k, kind, câu, nghĩa là)
    pts: list[tuple[int, int, str, str, str]] = []
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
        why = {"absorb_s": f"Mua chủ động dồn vào {where} mà giá không lên được: có người bán đặt chờ chặn ở đây.",
               "absorb_b": f"Bán chủ động dồn vào {where} mà giá không xuống được: có người mua đặt chờ đỡ ở đây.",
               "stack_s": f"Bán chủ động lấn liên tiếp nhiều bước giá ở {where}, phần lớn là cá mập: thường thành kháng cự.",
               "stack_b": f"Mua chủ động lấn liên tiếp nhiều bước giá ở {where}, phần lớn là cá mập: thường thành hỗ trợ.",
               "exh_b": f"Đẩy xuống {where} thì hết người bán đuổi theo: mốc sàn.",
               "exh_s": f"Đẩy lên {where} thì hết người mua đuổi theo: mốc trần."}[z["kind"]]
        if z["proofs"]:
            why += f" Giá quay lại test {len(z['proofs'])} lần đều bị bật ra: {role} đang được giữ."
        if z["broke"] is not None:
            why += f" Về sau giá đóng xuyên qua lúc {bars[z['broke']]['t']}: bên giữ vùng đã thua."
        pts.append((3, z["k"], "whale", s, why))
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
                pts.append((3, k, "fake", f"thủng giả {px(b['l'])} (đáy chỉ {kf(ev)} cp), đóng lại {px(b['c'])}",
                            f"Chọc xuống đáy mới mà gần như không ai bán theo, rồi kéo ngược lên: nhịp rũ bỏ, "
                            f"đáy thật vẫn quanh {px(prev_lo)}."))
                fake_k.add(k)
        if n >= 2 and prev_hi is not None and b["h"] > prev_hi + E and b["c"] <= prev_hi + E:
            edge = b["lv"][0]
            ev = edge[1] + edge[2] + edge[3]
            if ev <= FAKE_EDGE * b["vol"]:
                pts.append((3, k, "fake", f"vượt giả {px(b['h'])} (đỉnh chỉ {kf(ev)} cp), đóng lại {px(b['c'])}",
                            f"Chọc lên đỉnh mới mà gần như không ai mua theo, rồi rơi lại: nhịp bẫy mua, "
                            f"đỉnh thật vẫn quanh {px(prev_hi)}."))
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
            if low0 is not None and bb["l"] >= low0 - E:
                s = f"{head} mà không thủng {px(low0)} → bán bị hấp thụ ở đáy"
                why = (f"Bán chủ động dồn dập nhất buổi sáng nhưng không tạo được đáy mới: có người mua đặt chờ "
                       f"đang ôm hàng quanh {px(bb['l'])}–{px(bb['c'])}.")
            else:
                s = f"{head}, tạo đáy mới {px(bb['l'])} → bán có kết quả"
                why = "Bán dồn và giá đi tiếp xuống: bên bán đang thắng ở nhịp này."
        else:
            high0 = max((b["h"] for b in before), default=None)
            if high0 is not None and bb["h"] <= high0 + E:
                s = f"{head} mà không vượt {px(high0)} → mua bị hấp thụ ở đỉnh"
                why = (f"Mua chủ động dồn dập nhất buổi sáng nhưng không tạo được đỉnh mới: có người bán đặt chờ "
                       f"đang xả hàng quanh {px(bb['c'])}–{px(bb['h'])}.")
            else:
                s = f"{head}, tạo đỉnh mới {px(bb['h'])} → mua có kết quả"
                why = "Mua dồn và giá đi tiếp lên: bên mua đang thắng ở nhịp này."
        pts.append((3, kb, "effort", s, why))
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
                nst = round((hi - lo) / st) + 1
                pts.append((2, k, "stack", f"{'bán' if side == 's' else 'mua'} xếp chồng {px(lo)}–{px(hi)} → {role}",
                            f"{'Bán' if side == 's' else 'Mua'} chủ động lấn liên tiếp {nst} bước giá và chưa bị đóng "
                            f"xuyên: vùng này thường thành {'kháng cự' if side == 's' else 'hỗ trợ'} cho các nến sau."))
                stacks.append({"lo": lo, "hi": hi, "side": side})
    for k, b in B:
        for kind in b["sig"]:
            if kind in ("exh_b", "exh_s") and (k, kind) not in used and k not in fake_k:
                p = b["l"] if kind == "exh_b" else b["h"]
                pts.append((1, k, "exh", f"{NAME[kind]} ở {px(p)}",
                            f"Đẩy tới {px(p)} thì không còn ai {'bán' if kind == 'exh_b' else 'mua'} đuổi theo: "
                            f"mốc {'sàn' if kind == 'exh_b' else 'trần'} của buổi sáng."))
    for k, b in B:
        for kind in b["sig"]:
            if kind == "div_b":
                pts.append((2, k, "div_b", f"phân kỳ đáy: giá thủng xuống {px(b['l'])} mà CVD cao hơn lúc tạo đáy cũ",
                            "Giá còn tạo đáy mới nhưng tổng lực bán chủ động ít hơn lần trước: lực bán yếu dần."))
            elif kind == "div_s":
                pts.append((2, k, "div_s", f"phân kỳ đỉnh: giá vượt lên {px(b['h'])} mà CVD thấp hơn lúc tạo đỉnh cũ",
                            "Giá còn tạo đỉnh mới nhưng tổng lực mua chủ động ít hơn lần trước: lực mua yếu dần."))
    ranked = sorted(pts, key=lambda x: -x[0])
    main = {id(x) for x in ranked[:MAX_POINTS]}
    points = [{"k": k, "t": bars[k]["t"], "kind": kind, "txt": f"{bars[k]['t']} · {s}", "why": why,
               "minor": id(x) not in main, **_tag(kind, s)}
              for x in sorted(pts, key=lambda x: x[1]) for _, k, kind, s, why in [x]]

    # ---- bức tranh tổng
    sg = lambda n: f"{'+' if n > 0 else '−' if n < 0 else ''}{abs(n)}"   # noqa: E731
    va_lo, va_hi, poc = value_area(B)
    vw = B[-1][1].get("vw")
    summary = []
    if len(B) >= 4:
        d_early = sum(b["d"] for _, b in B[:2])
        summary.append(f"30' đầu: giá {px(open_p)} → {px(early_c)} ({sg(ticks(open_p, early_c))} bước), delta {tr(d_early)}.")
        summary.append(f"Sau đó ({rest[0][1]['t']}–11:30): giá {px(early_c)} → {px(last)} ({sg(R)} bước) trong hộp {box} "
                       f"rộng {boxw} bước; delta {tr(sum(b['d'] for _, b in rest))} = {sg(round(Ep))} % KL chủ động.")
    if abs(R) <= max(1, boxw // 2):
        summary.append("Nỗ lực không có kết quả: bán ròng nhiều mà giá gần như đứng → có người mua đặt chờ đang đỡ."
                       if Ep <= -LEAN_E else
                       "Nỗ lực không có kết quả: mua ròng nhiều mà giá gần như đứng → có người bán đặt chờ đang chặn."
                       if Ep >= LEAN_E else "Hai bên cân nhau: delta nhỏ, giá đi ngang.")
    elif R > 0:
        summary.append("Giá lên theo lực mua chủ động: bên mua đang có kết quả." if Ep >= 0 else
                       "Giá lên dù bán ròng: có người mua đặt chờ hấp thụ lực bán.")
    else:
        summary.append("Giá xuống theo lực bán chủ động: bên bán đang có kết quả." if Ep <= 0 else
                       "Giá xuống dù mua ròng: có người bán đặt chờ hấp thụ lực mua.")
    if len(rest) >= 4:
        lows, highs = [b["l"] for _, b in rest], [b["h"] for _, b in rest]
        i_lo, i_hi = lows.index(min(lows)), highs.index(max(highs))
        hl = i_lo < len(rest) - 2 and min(lows[-2:]) > min(lows) + E       # đáy sau cao hơn đáy thấp nhất
        lh = i_hi < len(rest) - 2 and max(highs[-2:]) < max(highs) - E      # đỉnh sau thấp hơn đỉnh cao nhất
        flat_hi = max(highs[-2:]) >= box_hi - E
        flat_lo = min(lows[-2:]) <= box_lo + E
        if hl and lh:
            summary.append(f"Đáy nâng dần ({px(min(lows))} → {px(min(lows[-2:]))}), đỉnh hạ dần ({px(max(highs))} → "
                           f"{px(max(highs[-2:]))}): hộp hẹp dần, hay kết thúc bằng một cú phá hộp.")
        elif hl:
            summary.append(f"Đáy nâng dần ({px(min(lows))} → {px(min(lows[-2:]))})" +
                           (f", đỉnh đi ngang {px(box_hi)}: bên mua ép dần lên trần, nghiêng phá lên." if flat_hi else
                            ": bên mua đỡ giá cao dần."))
        elif lh:
            summary.append(f"Đỉnh hạ dần ({px(max(highs))} → {px(max(highs[-2:]))})" +
                           (f", đáy đi ngang {px(box_lo)}: bên bán ép dần xuống sàn, nghiêng phá xuống." if flat_lo else
                            ": bên bán chặn giá thấp dần."))
    if poc is not None:
        pos = "trong" if va_lo - E <= last <= va_hi + E else "trên" if last > va_hi else "dưới"
        summary.append(f"Vùng giá trị sáng {px(va_lo)}–{px(va_hi)} (70 % KL khớp liên tục), POC {px(poc)}; "
                       f"giá cuối {px(last)} nằm {pos} vùng giá trị.")
    if vw:
        rel = "trên" if last > vw + E else "dưới" if last < vw - E else "ngang"
        summary.append(f"Giá cuối {rel} VWAP sáng {px(round(vw, 2))}: người mua trong buổi sáng đang "
                       f"{'lãi' if rel == 'trên' else 'lỗ' if rel == 'dưới' else 'hoà'} bình quân.")

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
    if vw:
        add(round(round(vw / step) * step, 2), f"VWAP sáng {px(round(vw, 2))}")
    if poc is not None:
        add(poc, "POC sáng")
    levels = []
    for p in sorted(lv, reverse=True):
        names = " · ".join(dict.fromkeys(lv[p]))
        where = "tren" if p > box_hi + E else "duoi" if p < box_lo - E else "hop"
        if where == "tren":
            sig = "đóng trên + delta dương: đi tiếp lên"
        elif abs(p - box_hi) < E:
            sig = "đóng trên + delta dương: phá trần hộp, bên mua thắng"
        elif abs(p - box_lo) < E:
            sig = "đóng dưới + delta âm: thủng sàn hộp, bên bán thắng"
        elif where == "duoi":
            sig = "đóng dưới + delta âm: đi tiếp xuống"
        elif "trần cá mập" in names or "bán xếp chồng" in names:
            sig = "chạm mà bật xuống, delta âm: trần còn giữ · đóng trên: trần vỡ"
        elif "sàn cá mập" in names or "mua xếp chồng" in names:
            sig = "chạm mà bật lên, delta dương: sàn còn giữ · đóng dưới: sàn vỡ"
        elif "VWAP" in names or "POC" in names:
            sig = "giá quanh đây là cân bằng · đứng trên: bên mua nhỉnh · dưới: bên bán nhỉnh"
        else:
            sig = "mốc giữa hộp"
        levels.append({"p": p, "txt": names, "where": where, "sig": sig})
    ups = [x["p"] for x in levels if x["where"] == "tren"][::-1][:2]
    dns = [x["p"] for x in levels if x["where"] == "duoi"][:2]
    watch = f"Canh: đóng > {px(box_hi)} + delta dương → " + (" rồi ".join(map(px, ups)) or "trên đỉnh sáng") + \
        f" · đóng < {px(box_lo)} + delta âm → " + (" rồi ".join(map(px, dns)) or "dưới đáy sáng") + "."
    plan = [
        {"k": "up", "name": "Kịch bản lên", "cond": f"nến 15' đóng trên {px(box_hi)} với delta dương",
         "then": "mục tiêu " + " rồi ".join(map(px, ups)) if ups else "tìm đỉnh mới trên đỉnh sáng"},
        {"k": "dn", "name": "Kịch bản xuống", "cond": f"nến 15' đóng dưới {px(box_lo)} với delta âm",
         "then": "mục tiêu " + " rồi ".join(map(px, dns)) if dns else "tìm đáy mới dưới đáy sáng"},
        {"k": "mid", "name": "Giằng co tiếp", "cond": f"giá còn quay trong {box}",
         "then": "đứng ngoài, không vào lệnh giữa hộp; chờ một phía thắng"},
    ]
    lean_txt = {1: "lên", -1: "xuống", 0: "không nghiêng bên nào"}[lean]
    return {"tf": TF, "upto": bars[-1]["t"], "open": open_p, "last": last, "moves": moves, "delta": delta,
            "box": [box_lo, box_hi], "v": v, "lean": lean, "lean_txt": lean_txt, "title": title, "sub": sub,
            "summary": summary, "points": points, "levels": levels, "watch": watch, "plan": plan}


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
