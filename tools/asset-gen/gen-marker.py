# 撮影トグル用の印刷マーカーカードを生成する。
#
# アプリ (arkit-capture の QR スキャン) は payload "ROOTLENS:REC" の QR を検出すると
# 待機中なら録画開始、録画中なら終了をトグルする。ジェスチャー・音声が通らない現場での
# 決定的なフォールバック。カードは A6 300dpi 相当。厨房で使うのでラミネート推奨。
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
MARGIN = 90

JP_FONT_CANDIDATES = [
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
    "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
]


def load_font(size: int) -> ImageFont.FreeTypeFont | None:
    for path in JP_FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return None


def main() -> None:
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    out_path = os.path.join(
        repo_root, "document", "business", "templates", "data-cooperation", "marker-rec.png"
    )

    # 誤り訂正 H (30%): 粉・汚れ・反射に強くする。box_size は後で高解像度へリサイズするので粗くてよい。
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H, border=2)
    qr.add_data(PAYLOAD)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="black", back_color="white").convert("L")

    card = Image.new("L", (CARD_W, CARD_H), 255)
    draw = ImageDraw.Draw(card)

    qr_size = CARD_W - MARGIN * 2
    qr_big = qr_img.resize((qr_size, qr_size), Image.NEAREST)  # モジュール境界をシャープに保つ
    card.paste(qr_big, (MARGIN, MARGIN))

    title_font = load_font(110)
    sub_font = load_font(58)
    text_top = MARGIN + qr_size + 70
    if title_font and sub_font:
        title = "さつえい 開始 / 終了"
        sub = "このカードをカメラに見せると\n撮影が始まり、もう一度見せると終わります"
        tw = draw.textlength(title, font=title_font)
        draw.text(((CARD_W - tw) / 2, text_top), title, font=title_font, fill=0)
        for i, line in enumerate(sub.split("\n")):
            lw = draw.textlength(line, font=sub_font)
            draw.text(((CARD_W - lw) / 2, text_top + 170 + i * 80), line, font=sub_font, fill=0)
    else:
        # 日本語フォントが見つからない環境では英語キャプションに落とす。
        fallback = ImageFont.load_default(size=72)
        title = "REC START / STOP"
        tw = draw.textlength(title, font=fallback)
        draw.text(((CARD_W - tw) / 2, text_top), title, font=fallback, fill=0)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    card.save(out_path, dpi=(300, 300))
    print(f"wrote {out_path} (payload={PAYLOAD})")


if __name__ == "__main__":
    main()
