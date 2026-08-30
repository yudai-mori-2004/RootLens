#!/usr/bin/env python3
"""Build the one-page A4 RootLens progress handout for the Osaki meeting."""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph


ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / "output/pdf/business/RootLens_progress_handout_since_2026-08-05.pdf"

FONT_PATH = Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf")
FONT_NAME = "RootLensJapanese"

INK = colors.black
MUTED = colors.HexColor("#555555")
LINE = colors.HexColor("#888888")
LIGHT_LINE = colors.HexColor("#C8C8C8")
PAPER = colors.white


def paragraph_style(name: str, size: float, leading: float, color=INK) -> ParagraphStyle:
    return ParagraphStyle(
        name,
        fontName=FONT_NAME,
        fontSize=size,
        leading=leading,
        textColor=color,
        alignment=TA_LEFT,
        wordWrap="CJK",
        splitLongWords=True,
        spaceAfter=0,
        spaceBefore=0,
    )


def draw_paragraph(c: canvas.Canvas, text: str, x: float, y_top: float, width: float, style: ParagraphStyle) -> float:
    paragraph = Paragraph(text, style)
    _, height = paragraph.wrap(width, 1000 * mm)
    paragraph.drawOn(c, x, y_top - height)
    return height


def draw_section(
    c: canvas.Canvas,
    title: str,
    bullets: list[str],
    x: float,
    y_top: float,
    width: float,
    title_style: ParagraphStyle,
    body_style: ParagraphStyle,
) -> float:
    title_height = draw_paragraph(c, title, x, y_top, width, title_style)
    line_y = y_top - title_height - 0.7 * mm
    c.setStrokeColor(INK)
    c.setLineWidth(0.7)
    c.line(x, line_y, x + width, line_y)
    cursor = line_y - 2.1 * mm

    for bullet in bullets:
        c.setFillColor(INK)
        c.circle(x + 1.3 * mm, cursor - 2.2 * mm, 0.65 * mm, fill=1, stroke=0)
        height = draw_paragraph(c, bullet, x + 4 * mm, cursor, width - 4 * mm, body_style)
        cursor -= height + 1.15 * mm

    return y_top - cursor


def draw_metric(c: canvas.Canvas, x: float, y: float, width: float, value: str, label: str) -> None:
    c.setFillColor(PAPER)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.6)
    c.rect(x, y, width, 15.5 * mm, fill=1, stroke=1)
    c.setFillColor(INK)
    c.setFont(FONT_NAME, 14)
    c.drawCentredString(x + width / 2, y + 8.8 * mm, value)
    c.setFillColor(MUTED)
    c.setFont(FONT_NAME, 7.5)
    c.drawCentredString(x + width / 2, y + 3.2 * mm, label)


def build() -> None:
    if not FONT_PATH.exists():
        raise FileNotFoundError(FONT_PATH)
    pdfmetrics.registerFont(TTFont(FONT_NAME, str(FONT_PATH)))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    page_width, page_height = A4
    c = canvas.Canvas(str(OUTPUT), pagesize=A4, pageCompression=1)
    c.setTitle("RootLens 進捗報告（8月5日以降）")
    c.setAuthor("RootLens")
    c.setFillColor(PAPER)
    c.rect(0, 0, page_width, page_height, fill=1, stroke=0)

    left = 14 * mm
    right = page_width - 14 * mm
    usable_width = right - left

    # Header
    c.setFillColor(INK)
    c.setFont(FONT_NAME, 16)
    c.drawString(left, page_height - 15 * mm, "RootLens　進捗報告（8月5日以降）")
    c.setFillColor(MUTED)
    c.setFont(FONT_NAME, 8.5)
    c.drawString(left, page_height - 23 * mm, "2026年8月30日　｜　大崎さん・協力店舗向け")
    c.drawRightString(right, page_height - 23 * mm, "ミーティング配布資料")
    c.setStrokeColor(INK)
    c.setLineWidth(1.0)
    c.line(left, page_height - 29 * mm, right, page_height - 29 * mm)

    title_style = paragraph_style("section", 10.8, 14.0, INK)
    body_style = paragraph_style("body", 9.2, 12.8, INK)
    overview_style = paragraph_style("overview", 9.5, 13.5, INK)
    small_style = paragraph_style("small", 7.8, 10.0, MUTED)

    overview_top = page_height - 34 * mm
    overview_height = draw_paragraph(
        c,
        "8月5日のミーティング以降、米国AI企業Claruの撮影案件に向けて、撮影機材、確認用映像、現場での運用方法、合意文書の準備を進めました。本日は、前回から進んだ内容と現在地を共有し、次の撮影に向けた実施条件を確認します。",
        left,
        overview_top,
        usable_width,
        overview_style,
    )

    # Key figures
    metric_y = overview_top - overview_height - 20 * mm
    gap = 3.5 * mm
    metric_width = (usable_width - gap * 2) / 3
    draw_metric(c, left, metric_y, metric_width, "50時間（想定）", "Claruの撮影テスト")
    draw_metric(c, left + metric_width + gap, metric_y, metric_width, "5時間53分51秒", "作成済みの確認用候補")
    draw_metric(c, left + (metric_width + gap) * 2, metric_y, metric_width, "2店舗から開始", "パン屋・焼き鳥店")

    y = metric_y - 7 * mm
    y -= draw_section(
        c,
        "1. 8月5日以降に進めたこと",
        [
            "Claruが従来のパン屋での撮影サンプルを確認し、継続して撮影できる量・価格・開始時期について問い合わせがあった。",
            "8月19日に新しい撮影案件の資料を受領し、まずは「レストラン・商業キッチン」の分野に集中する方針を決めた。",
            "スマートグラスとiPhoneの両方で、映像・音声・動きの情報を記録できる撮影方法を整えた。作業中は本体の物理ボタンだけで開始・停止できる。",
            "実際に長時間撮影を行い、確認用として40本、合計5時間53分51秒の候補映像を作成した。",
            "店舗との基本合意書、映像に入る方の同意書、米国へのデータ提供に関する説明書を作成し、大崎さんの助言を反映した第3次修正版まで進めた。",
            "iPhoneを額の位置へ安定して装着するための固定具を試作し、印刷して装着確認できる段階まで設計した。",
        ],
        left,
        y,
        usable_width,
        title_style,
        body_style,
    )
    y -= 3.2 * mm
    y -= draw_section(
        c,
        "2. 撮影運用として整えたこと",
        [
            "普段の業務中に撮影機材を装着し、作業の開始時と一区切りついた時に、作業者自身で録画を開始・停止していただく。",
            "撮影は、店舗と参加者が合意した時間・場所・作業に限る。お客様や同意していない方が映らない時間帯・区画を基本とする。",
            "撮影データには映像・音声・機材の動きが含まれ、同意を得たうえで米国企業などのAI開発先へ提供される可能性がある。",
            "協力費と支払条件は、正式な案件内容と採用条件が決まった段階で、撮影前に書面で提示する。",
        ],
        left,
        y,
        usable_width,
        title_style,
        body_style,
    )
    y -= 3.2 * mm
    y -= draw_section(
        c,
        "3. 現在の状況",
        [
            "撮影機材、確認用映像、長時間撮影を作業ごとに整理する方法は、こちら側で準備できている。",
            "Claruによる新しい確認用映像の正式な受入れ、契約、50時間分の発注はまだ確定していない。",
            "パン屋・焼き鳥店について、正式な店舗合意、参加者、撮影時間、協力費はこれから確定する。",
        ],
        left,
        y,
        usable_width,
        title_style,
        body_style,
    )
    y -= 3.2 * mm
    y -= draw_section(
        c,
        "4. 本日確認したいこと",
        [
            "パン屋・焼き鳥店で撮影に協力できる範囲、曜日、時間帯、作業内容。",
            "撮影に参加するスタッフの範囲と、お客様や非参加者が映らない運用方法。",
            "店舗への説明、スタッフへの説明、個人の同意記録を、店舗側とRootLens側でどう分担するか。",
            "最初の確認撮影を、誰が・いつ・何時間行うか。",
            "協力費をどの時点で、どのような基準で提示するか。",
            "合意書と同意書の内容に、現場で運用しにくい点や不足がないか。",
        ],
        left,
        y,
        usable_width,
        title_style,
        body_style,
    )
    y -= 3.2 * mm
    y -= draw_section(
        c,
        "5. その他の動き",
        [
            "別の海外企業からも既存の一人称視点データについて照会を受けた。独占提供済みのデータと、今後新たに撮影できるデータを分けて回答する。",
            "将来的に撮影データをロボット学習と現場への価値へつなげるため、Muso Actionの研究インターンへ応募した。",
        ],
        left,
        y,
        usable_width,
        title_style,
        body_style,
    )

    # Footer
    c.setStrokeColor(LIGHT_LINE)
    c.setLineWidth(0.5)
    c.line(left, 15 * mm, right, 15 * mm)
    draw_paragraph(
        c,
        "RootLens　森 雄大　｜　前回ミーティング以降の内部進捗と、次の撮影に向けた確認事項をまとめています。",
        left,
        11.5 * mm,
        usable_width,
        small_style,
    )

    c.showPage()
    c.save()


if __name__ == "__main__":
    build()
