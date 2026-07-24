# 撮影禁止マーカー (= ぼかしマーカー) のステッカーシートを生成する。
#
# 納品パイプライン (tools/modal/fpvlabs/fpvlabs.py) が ArUco DICT_4X4_50 を検出し、
# マーカー周囲の実寸ゾーンをぼかす。ここで刷る黒枠実寸 (70mm) が cm → px 換算の基準なので、
# 原寸印刷が前提。id → ゾーンの対応は fpvlabs.py の NG_MARKER_ZONES と 1:1 に保つ。
#
# 紙面はイラスト主体: 「カメラ⊘ → モザイク化した図形」のピクトグラムで意味を伝え、
# 文字は寸法 (半径50cm 等) と隅の識別だけ。ぼかしの形 (円 / 四角) はモザイク図形の形で示す。
#
# 使い方: python3 tools/asset-gen/gen-ng-markers.py
# 出力:   document/business/templates/data-cooperation/ng-markers-1.png, ng-markers-2.png

from __future__ import annotations

import os

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

DPI = 300
MM = DPI / 25.4  # px per mm

# fpvlabs.py の NG_MARKER_ZONES と揃える (id, 寸法表記, 形)
STICKERS = [
    (0, "半径25cm", "circle"),
    (1, "半径50cm", "circle"),
    (2, "半径1m", "circle"),
    (10, "40×30cm", "rect"),
    (11, "90×60cm", "rect"),
    (12, "180×90cm", "rect"),
]

MARKER_MM = 70          # ArUco 黒枠の実寸 (= fpvlabs.py NG_MARKER_SIZE_CM と一致)
STICKER_W_MM = 94
STICKER_H_MM = 112
PAGE_W, PAGE_H = int(210 * MM), int(297 * MM)  # A4 縦

JP_FONT_CANDIDATES = [
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
    "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
]


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in JP_FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default(size=size)


def load_no_video_icon(height: int) -> Image.Image:
    """撮影カメラ⊘ のピクトグラム (生成済みアセット) を白地トリム + 二値化して読み込む。"""
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    path = os.path.join(repo_root, "document", "business", "templates", "assets", "icon-no-video.png")
    icon = Image.open(path).convert("L").point(lambda p: 0 if p < 128 else 255)
    inv = icon.point(lambda p: 255 - p)
    bbox = inv.getbbox()
    if bbox:
        icon = icon.crop(bbox)
    w = int(icon.width * height / icon.height)
    return icon.resize((w, height), Image.LANCZOS)


def draw_mosaic_shape(img: Image.Image, cx: int, cy: int, size: int, shape: str) -> None:
    """「ぼかされた後」を表すモザイク図形。 2mm 角のグレー市松を円 / 四角のマスクで抜く。"""
    tile = max(2, int(1.8 * MM))
    pat = Image.new("L", (size, size), 255)
    pd = ImageDraw.Draw(pat)
    for ty in range(0, size, tile):
        for tx in range(0, size, tile):
            # 3 値の市松 (= モザイクらしい濃淡)。 決定的パターンで再現可能に保つ。
            v = (tx // tile * 3 + ty // tile * 5) % 4
            fill = (150, 200, 230, 255)[v]
            pd.rectangle([tx, ty, tx + tile - 1, ty + tile - 1], fill=fill)
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    if shape == "circle":
        md.ellipse([0, 0, size - 1, size - 1], fill=255)
    else:
        md.rectangle([int(size * 0.04), int(size * 0.18), int(size * 0.96), int(size * 0.82)], fill=255)
    img.paste(pat, (cx - size // 2, cy - size // 2), mask)
    # 輪郭線 (= 図形として読めるように)
    d = ImageDraw.Draw(img)
    lw = max(2, int(0.5 * MM))
    if shape == "circle":
        d.ellipse([cx - size // 2, cy - size // 2, cx + size // 2 - 1, cy + size // 2 - 1],
                  outline=0, width=lw)
    else:
        d.rectangle([cx - size // 2 + int(size * 0.04), cy - size // 2 + int(size * 0.18),
                     cx + size // 2 - int(size * 0.04), cy - size // 2 + int(size * 0.82)],
                    outline=0, width=lw)


def render_sticker(marker_id: int, size_label: str, shape: str) -> Image.Image:
    w, h = int(STICKER_W_MM * MM), int(STICKER_H_MM * MM)
    img = Image.new("L", (w, h), 255)
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, w - 1, h - 1], outline=0, width=max(4, int(0.8 * MM)))

    # ── ArUco マーカー (黒枠実寸 MARKER_MM、 周囲 ≥10mm の白 = クワイエットゾーン) ──
    aruco = cv2.aruco
    dictionary = aruco.getPredefinedDictionary(aruco.DICT_4X4_50)
    gen = aruco.generateImageMarker if hasattr(aruco, "generateImageMarker") else aruco.drawMarker
    mpx = int(MARKER_MM * MM)
    marker = Image.fromarray(np.asarray(gen(dictionary, marker_id, mpx)))
    mx = (w - mpx) // 2
    my = int(10 * MM)
    img.paste(marker, (mx, my))

    # ── 視覚文: [カメラ⊘] → [モザイク図形] (= 撮られてもこの形にぼかされる) ──
    row_cy = my + mpx + int(9 * MM)
    icon_h = int(11 * MM)
    icon = load_no_video_icon(icon_h)
    glyph = int(12 * MM)
    arrow_w = int(8 * MM)
    total = icon.width + int(4 * MM) + arrow_w + int(4 * MM) + glyph
    x0 = (w - total) // 2
    img.paste(icon, (x0, row_cy - icon_h // 2))
    ax = x0 + icon.width + int(4 * MM)
    lw = max(3, int(0.7 * MM))
    draw.line([ax, row_cy, ax + arrow_w - int(2.2 * MM), row_cy], fill=0, width=lw)
    draw.polygon([(ax + arrow_w, row_cy),
                  (ax + arrow_w - int(2.6 * MM), row_cy - int(1.6 * MM)),
                  (ax + arrow_w - int(2.6 * MM), row_cy + int(1.6 * MM))], fill=0)
    draw_mosaic_shape(img, x0 + total - glyph // 2, row_cy, glyph, shape)

    # ── 寸法 (= 文字はここだけ) ──
    head_font = load_font(int(7.2 * MM))
    tw = draw.textlength(size_label, font=head_font)
    draw.text(((w - tw) / 2, row_cy + int(8 * MM)), size_label, font=head_font, fill=0)

    foot_font = load_font(int(2.6 * MM))
    foot = f"RootLens No.{marker_id}"
    fw = draw.textlength(foot, font=foot_font)
    draw.text((w - fw - int(3.5 * MM), h - int(5.5 * MM)), foot, font=foot_font, fill=120)

    return img


def main() -> None:
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    out_dir = os.path.join(repo_root, "document", "business", "templates", "data-cooperation")
    os.makedirs(out_dir, exist_ok=True)

    per_page = 4
    pages = [STICKERS[i:i + per_page] for i in range(0, len(STICKERS), per_page)]
    for page_no, items in enumerate(pages, start=1):
        page = Image.new("L", (PAGE_W, PAGE_H), 255)
        draw = ImageDraw.Draw(page)
        sw, sh = int(STICKER_W_MM * MM), int(STICKER_H_MM * MM)
        gap = int(6 * MM)
        ox = (PAGE_W - (sw * 2 + gap)) // 2
        oy = (PAGE_H - (sh * 2 + gap)) // 2
        for k, (mid, size_label, shape) in enumerate(items):
            x = ox + (k % 2) * (sw + gap)
            y = oy + (k // 2) * (sh + gap)
            page.paste(render_sticker(mid, size_label, shape), (x, y))
            draw.rectangle([x - 2, y - 2, x + sw + 1, y + sh + 1], outline=200, width=1)
        out_path = os.path.join(out_dir, f"ng-markers-{page_no}.png")
        page.save(out_path, dpi=(DPI, DPI))
        print(f"wrote {out_path} ({len(items)} stickers)")


if __name__ == "__main__":
    main()
