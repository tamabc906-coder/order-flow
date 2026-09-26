r"""Vẽ PNG icon PWA — không cần font. Chạy: venv\Scripts\python -m scripts.make_icons (chỉ máy dev).

Hình: một cột footprint — trục vàng ở giữa, các vạch đỏ sang trái (bán chủ động) và xanh sang phải (mua chủ động),
vạch dài nhất (POC) viền vàng; nền navy, khung vàng mảnh, đúng bảng màu ảnh mẫu.
"""
from pathlib import Path

from PIL import Image, ImageDraw

NAVY, NAVY2, GOLD, GOLD2 = (0x0B, 0x16, 0x28), (0x1A, 0x33, 0x60), (0xD4, 0xAF, 0x6A), (0xEB, 0xCB, 0x8B)
BUY, SELL = (0x3D, 0xBE, 0x7A), (0xE5, 0x57, 0x5C)
OUT = Path(__file__).resolve().parent.parent / "docs" / "icons"
# (bán, mua) mỗi vạch, trên → dưới, đơn vị /120
ROWS = [(10, 18), (16, 26), (30, 22), (24, 36), (20, 14), (12, 8)]


def draw(size: int, maskable: bool) -> Image.Image:
    S = size * 4
    img = Image.new("RGBA", (S, S), NAVY if maskable else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if not maskable:
        d.rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 26 / 120), fill=NAVY)
    k = (S * 0.8 / 120) if maskable else (S / 120)
    off = (S - 120 * k) / 2

    def P(x, y):
        return (off + x * k, off + y * k)

    # khung vàng mảnh + nền gradient đơn giản (2 lớp)
    x1, y1 = P(10, 10)
    x2, y2 = P(110, 110)
    d.rounded_rectangle((x1, y1, x2, y2), radius=int(18 * k), fill=NAVY2, outline=GOLD, width=max(2, int(2.4 * k)))
    cx = 60
    y = 24
    h = 10
    for n, (s, b) in enumerate(ROWS):
        a1, b1 = P(cx - s, y)
        a2, b2 = P(cx, y + h - 2.5)
        d.rectangle((a1, b1, a2, b2), fill=SELL)
        a1, b1 = P(cx, y)
        a2, b2 = P(cx + b, y + h - 2.5)
        d.rectangle((a1, b1, a2, b2), fill=BUY)
        if n == 3:  # POC
            a1, b1 = P(cx - s - 2, y - 2)
            a2, b2 = P(cx + b + 2, y + h - 0.5)
            d.rectangle((a1, b1, a2, b2), outline=GOLD2, width=max(2, int(1.6 * k)))
        y += h + 2
    a1, b1 = P(cx - 1.2, 18)
    a2, b2 = P(cx + 1.2, 102)
    d.rectangle((a1, b1, a2, b2), fill=GOLD)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    draw(192, False).save(OUT / "icon-192.png")
    draw(512, False).save(OUT / "icon-512.png")
    draw(512, True).convert("RGB").save(OUT / "icon-maskable.png")
    print("wrote icons ->", OUT)


if __name__ == "__main__":
    main()
