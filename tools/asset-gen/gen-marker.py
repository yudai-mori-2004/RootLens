# 撮影トグル用の印刷マーカーカードを生成する。
#
# アプリ (arkit-capture の QR スキャン) は payload "ROOTLENS:REC" の QR を検出すると
# 待機中なら録画開始、録画中なら終了をトグルする。ジェスチャー・音声が通らない現場での
# 決定的なフォールバック。カードは A6 300dpi 相当。厨房で使うのでラミネート推奨。
#
# デザインはブランドのインク紫 + ライム 1 色。QR の検出性が最優先なので、
# QR 本体は白地プレートの内側に素のまま置き、装飾はプレートの外に限る。
#
# 使い方: python3 tools/asset-gen/gen-marker.py
# 出力:   document/business/templates/data-cooperation/marker-rec.png

from __future__ import annotations

import os

import qrcode
from PIL import Image, ImageDraw, ImageFont

PAYLOAD = "ROOTLENS:REC"

# A6 300dpi 縦 (105 x 148 mm)
CARD_W, CARD_H = 1240, 1748

INK = (27, 7, 51)        # #1b0733
BODY = (64, 53, 90)      # 説明文用の薄いインク
LIME = (200, 255, 0)     # #c8ff00
PAPER = (255, 255, 255)

JP_FONT_CANDIDATES = [
    "/System/Library/Fonts/ヒラギノ角ゴシック W8.ttc",
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
    "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
]
LATIN_FONT = "/System/Library/Fonts/Supplemental/Futura.ttc"


def load_jp_font(size: int) -> ImageFont.FreeTypeFont:
    for path in JP_FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    raise RuntimeError("日本語フォントが見つからない (JP_FONT_CANDIDATES を確認)")


def load_latin_font(size: int) -> ImageFont.FreeTypeFont:
    # Futura.ttc から Condensed ExtraBold を探す。無ければ最初のフェイスで妥協する。
    if os.path.exists(LATIN_FONT):
        for idx in range(12):
            try:
                f = ImageFont.truetype(LATIN_FONT, size, index=idx)
            except OSError:
                break
            name = " ".join(f.getname())
            if "Condensed" in name and ("ExtraBold" in name or "Extra Bold" in name):
                return f
        return ImageFont.truetype(LATIN_FONT, size, index=0)
    return load_jp_font(size)


def ink_logo(repo_root: str, size: int) -> Image.Image:
    # rootlens_R.png はほぼ白のマークなので、アルファをマスクにインク色で塗り直す。
    path = os.path.join(repo_root, "document", "business", "templates", "assets", "rootlens_R.png")
    logo = Image.open(path).convert("RGBA").resize((size, size), Image.LANCZOS)
    colored = Image.new("RGBA", logo.size, INK + (255,))
    colored.putalpha(logo.split()[-1])
    return colored


def rounded_rect(draw: ImageDraw.ImageDraw, box, radius, **kw) -> None:
    draw.rounded_rectangle(box, radius=radius, **kw)


def main() -> None:
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    out_path = os.path.join(
        repo_root, "document", "business", "templates", "data-cooperation", "marker-rec.png"
    )

    card = Image.new("RGB", (CARD_W, CARD_H), PAPER)
    draw = ImageDraw.Draw(card)

    # 背景のドットグリッド (プレートと文字の下には残らないよう薄く)
    dot = (27, 7, 51)
    for y in range(70, CARD_H - 40, 46):
        for x in range(70, CARD_W - 40, 46):
            draw.ellipse((x - 2, y - 2, x + 2, y + 2), fill=(237, 233, 243))

    # 外枠 (インクのフレーム)
    rounded_rect(draw, (26, 26, CARD_W - 26, CARD_H - 26), radius=22, outline=INK, width=8)

    # ── ヘッダ: ロゴロックアップ + 傾けたライムのタグ ──
    logo = ink_logo(repo_root, 96)
    card.paste(logo, (78, 68), logo)
    wm_font = load_latin_font(88)
    draw.text((192, 74), "RootLens", font=wm_font, fill=INK)

    tag_font = load_jp_font(46)
    tag_text = "撮影マーカー"
    tw = int(draw.textlength(tag_text, font=tag_font))
    tag = Image.new("RGBA", (tw + 64, 46 + 40), (0, 0, 0, 0))
    tag_draw = ImageDraw.Draw(tag)
    tag_draw.rectangle((8, 8, tw + 56, 46 + 32), fill=(27, 7, 51, 90))          # 硬い影
    tag_draw.rectangle((0, 0, tw + 48, 46 + 24), fill=LIME + (255,))
    tag_draw.text((24, 10), tag_text, font=tag_font, fill=INK)
    tag = tag.rotate(-4, expand=True, resample=Image.BICUBIC)
    card.paste(tag, (CARD_W - tag.width - 58, 52), tag)

    # ── QR プレート (白地 + インク枠 + ライムの硬い影) ──
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H, border=0)
    qr.add_data(PAYLOAD)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="black", back_color="white").convert("L")

    plate_x0, plate_y0 = 130, 230
    plate_w = CARD_W - plate_x0 * 2
    quiet = 72  # 端末検出用の quiet zone (≥4 モジュール相当)
    qr_size = plate_w - quiet * 2
    modules = qr_img.size[0]
    qr_size -= qr_size % modules  # モジュール整数倍でシャープに
    plate_h = qr_size + quiet * 2
    plate_x1, plate_y1 = plate_x0 + plate_w, plate_y0 + plate_h

    rounded_rect(draw, (plate_x0 + 16, plate_y0 + 16, plate_x1 + 16, plate_y1 + 16),
                 radius=16, fill=LIME)                                           # 硬い影
    rounded_rect(draw, (plate_x0, plate_y0, plate_x1, plate_y1),
                 radius=16, fill=PAPER, outline=INK, width=6)

    qr_big = qr_img.resize((qr_size, qr_size), Image.NEAREST)
    qr_ink = Image.new("RGB", qr_big.size, PAPER)
    qr_ink.paste(Image.new("RGB", qr_big.size, INK), mask=qr_big.point(lambda v: 255 - v))
    card.paste(qr_ink, (plate_x0 + (plate_w - qr_size) // 2, plate_y0 + quiet))

    # ── タイトル: さつえい 開始 / 終了 (開始・終了はライムのチップ) ──
    title_font = load_jp_font(104)
    chip_pad_x, chip_pad_y = 26, 14
    y_title = plate_y1 + 92

    def chip_w(text: str) -> int:
        return int(draw.textlength(text, font=title_font)) + chip_pad_x * 2

    lead_text = "さつえい "
    sep_text = " / "
    lead_w = int(draw.textlength(lead_text, font=title_font))
    sep_w = int(draw.textlength(sep_text, font=title_font))
    total = lead_w + chip_w("開始") + sep_w + chip_w("終了")
    x = (CARD_W - total) // 2

    draw.text((x, y_title), lead_text, font=title_font, fill=INK)
    x += lead_w
    for i, word in enumerate(["開始", "終了"]):
        cw = chip_w(word)
        rounded_rect(draw, (x + 6, y_title - chip_pad_y + 8, x + cw + 6, y_title + 104 + chip_pad_y + 2),
                     radius=12, fill=(27, 7, 51))                                # 硬い影
        rounded_rect(draw, (x, y_title - chip_pad_y, x + cw, y_title + 104 + chip_pad_y - 6),
                     radius=12, fill=LIME)
        draw.text((x + chip_pad_x, y_title - 4), word, font=title_font, fill=INK)
        x += cw
        if i == 0:
            draw.text((x, y_title), sep_text, font=title_font, fill=INK)
            x += sep_w

    # ── 説明 2 行 ──
    sub_font = load_jp_font(54)
    sub_lines = ["このカードをカメラに見せると", "撮影が始まり、もう一度見せると終わります"]
    y_sub = y_title + 210
    for i, line in enumerate(sub_lines):
        lw = draw.textlength(line, font=sub_font)
        draw.text(((CARD_W - lw) / 2, y_sub + i * 82), line, font=sub_font, fill=BODY)

    # ── フッタ: rootlens.io ──
    foot_font = load_latin_font(56)
    foot = "rootlens.io"
    tracking = 6
    fw = sum(int(draw.textlength(c, font=foot_font)) + tracking for c in foot) - tracking
    fx = (CARD_W - fw) / 2
    fy = CARD_H - 150
    for c in foot:
        draw.text((fx, fy), c, font=foot_font, fill=INK)
        fx += draw.textlength(c, font=foot_font) + tracking

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    card.save(out_path, dpi=(300, 300))
    print(f"wrote {out_path} (payload={PAYLOAD})")


if __name__ == "__main__":
    main()
