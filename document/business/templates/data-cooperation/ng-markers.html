<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<style>
  /* ぼかしマーカーのステッカーシート。 下半分は「ゾーンの図 + ぼかしシール + 寸法」 だけ。
     図の中心には同じコードのミニマーカー (デフォルメ = 視認優先で実寸比より大きい) を置く。 */
  @page { size:A4; margin:0; }
  *{ margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  :root{
    --ink:#111111;
    --ink2:#333333;
    --gray:#777777;
    --cut:#C8C8C8;
    --mosaic-a:#9a9a9a;
    --mosaic-b:#c9c9c9;
    --mosaic-c:#e9e9e9;
  }
  html,body{ background:#fff; color:var(--ink);
    font-family:"Noto Sans CJK JP","Hiragino Sans",sans-serif;
    -webkit-font-smoothing:antialiased; text-rendering:geometricPrecision; }
  .page{ position:relative; width:210mm; height:297mm; overflow:hidden; background:#fff;
    page-break-after:always; }
  .grid{ position:absolute; inset:0; display:grid;
    grid-template-columns:94mm 94mm; grid-auto-rows:112mm; gap:6mm;
    justify-content:center; align-content:center; }

  /* ── ステッカー 1 枚 (94 × 112mm) ── */
  .sticker{ position:relative; border:1.1mm solid var(--ink); background:#fff;
    outline:0.3mm dashed var(--cut); outline-offset:1.2mm; /* 切り取りガイド */ }

  /* ArUco: 黒枠実寸 70mm (= パイプラインの換算基準)。 周囲 ≥10mm がクワイエットゾーン。 */
  .aruco{ display:block; width:70mm; height:70mm; margin:9mm auto 0; image-rendering:pixelated; }

  /* ── 下段: 左 = 縮尺図 / 右 = 寸法の数字 ── */
  .strip{ position:absolute; left:0; right:0; top:81mm; bottom:10mm;
    display:flex; align-items:center; gap:4mm; padding:0 6mm; }
  .diagram{ flex:none; height:20mm; width:auto; }
  .dim{ flex:1; text-align:right; line-height:1; white-space:nowrap; }
  .dim .ttl{ display:block; font-size:7.2mm; font-weight:900; }
  .dim .size{ display:block; margin-top:2mm; font-size:4.3mm; font-weight:800; color:var(--ink2); letter-spacing:0.2mm; }

  /* ── 右下ブランド (= フライヤーのブランド行と同じ、 黒地に白ロゴ + 白ワードマーク。
        ロゴ画像は白抜きなので黒チップの上でだけ成立する) ── */
  .brand{ position:absolute; right:3mm; bottom:2.4mm; display:flex; align-items:center; gap:1.5mm;
    background:var(--ink); border-radius:1.2mm; padding:1.3mm 2.6mm 1.3mm 2mm; }
  .brand img{ height:4.6mm; display:block; }
  .brand span{ font-size:3.6mm; font-weight:900; letter-spacing:0.1mm; color:#fff; }

  svg text{ font-family:"Noto Sans CJK JP","Hiragino Sans",sans-serif; }
</style>
</head>
<body>

<!-- SVG 共通定義: モザイクパターン + 寸法線の矢じり -->
<svg width="0" height="0" style="position:absolute">
  <defs>
    <pattern id="mosaic" width="2" height="2" patternUnits="userSpaceOnUse">
      <rect width="2" height="2" fill="var(--mosaic-c)"/>
      <rect width="1" height="1" fill="var(--mosaic-a)"/>
      <rect x="1" y="1" width="1" height="1" fill="var(--mosaic-b)"/>
    </pattern>
    <marker id="arr" viewBox="0 0 4 4" refX="3.2" refY="2" markerWidth="4" markerHeight="4" orient="auto">
      <path d="M0,0 L4,2 L0,4 z" fill="#111"/>
    </marker>
    <marker id="arrR" viewBox="0 0 4 4" refX="0.8" refY="2" markerWidth="4" markerHeight="4" orient="auto">
      <path d="M4,0 L0,2 L4,4 z" fill="#111"/>
    </marker>
  </defs>
</svg>

<div class="page">
  <div class="grid">

    <!-- No.0 円 半径25cm: 表示ゾーン d24mm / ミニマーカーはデフォルメ -->
    <div class="sticker">
      <img class="aruco" src="../assets/ng/aruco-0.png" alt="">
      <div class="strip">
        <svg class="diagram" width="34mm" height="26mm" viewBox="0 0 34 26">
          <circle cx="14" cy="12" r="12" fill="url(#mosaic)" stroke="#111" stroke-width="0.45"/>
          <line x1="14" y1="12" x2="26" y2="12" stroke="#111" stroke-width="0.35" marker-end="url(#arr)"/>
          <image href="../assets/ng/aruco-0.png" x="11" y="9" width="6" height="6"/>
          <line x1="10.7" y1="10.6" x2="12.6" y2="8.7" stroke="#fff" stroke-width="0.55"/>
        </svg>
        <div class="dim"><span class="ttl">ぼかしシール</span><span class="size">半径25cm</span></div>
      </div>
      <div class="brand"><img src="../assets/rootlens_R.png" alt=""><span>RootLens</span></div>
    </div>

    <!-- No.1 円 半径50cm: ミニマーカーはデフォルメ -->
    <div class="sticker">
      <img class="aruco" src="../assets/ng/aruco-1.png" alt="">
      <div class="strip">
        <svg class="diagram" width="34mm" height="26mm" viewBox="0 0 34 26">
          <circle cx="14" cy="12" r="12" fill="url(#mosaic)" stroke="#111" stroke-width="0.45"/>
          <line x1="14" y1="12" x2="26" y2="12" stroke="#111" stroke-width="0.35" marker-end="url(#arr)"/>
          <image href="../assets/ng/aruco-1.png" x="11" y="9" width="6" height="6"/>
          <line x1="10.7" y1="10.6" x2="12.6" y2="8.7" stroke="#fff" stroke-width="0.55"/>
        </svg>
        <div class="dim"><span class="ttl">ぼかしシール</span><span class="size">半径50cm</span></div>
      </div>
      <div class="brand"><img src="../assets/rootlens_R.png" alt=""><span>RootLens</span></div>
    </div>

    <!-- No.2 円 半径1m: ミニマーカーはデフォルメ -->
    <div class="sticker">
      <img class="aruco" src="../assets/ng/aruco-2.png" alt="">
      <div class="strip">
        <svg class="diagram" width="34mm" height="26mm" viewBox="0 0 34 26">
          <circle cx="14" cy="12" r="12" fill="url(#mosaic)" stroke="#111" stroke-width="0.45"/>
          <line x1="14" y1="12" x2="26" y2="12" stroke="#111" stroke-width="0.35" marker-end="url(#arr)"/>
          <image href="../assets/ng/aruco-2.png" x="11" y="9" width="6" height="6"/>
          <line x1="10.7" y1="10.6" x2="12.6" y2="8.7" stroke="#fff" stroke-width="0.55"/>
        </svg>
        <div class="dim"><span class="ttl">ぼかしシール</span><span class="size">半径1m</span></div>
      </div>
      <div class="brand"><img src="../assets/rootlens_R.png" alt=""><span>RootLens</span></div>
    </div>

    <!-- No.10 矩形 40×30cm: 表示 32×24mm / ミニマーカーはデフォルメ -->
    <div class="sticker">
      <img class="aruco" src="../assets/ng/aruco-10.png" alt="">
      <div class="strip">
        <svg class="diagram" width="40mm" height="26mm" viewBox="0 0 40 26">
          <rect x="2" y="1" width="32" height="24" fill="url(#mosaic)" stroke="#111" stroke-width="0.45"/>
          <line x1="4.4" y1="23" x2="31.6" y2="23" stroke="#111" stroke-width="0.3"
                marker-start="url(#arrR)" marker-end="url(#arr)"/>
          <line x1="32" y1="3.4" x2="32" y2="22.6" stroke="#111" stroke-width="0.3"
                marker-start="url(#arrR)" marker-end="url(#arr)"/>
          <image href="../assets/ng/aruco-10.png" x="14.5" y="9.5" width="7" height="7"/>
          <line x1="14.2" y1="11.1" x2="16.1" y2="9.2" stroke="#fff" stroke-width="0.55"/>
        </svg>
        <div class="dim"><span class="ttl">ぼかしシール</span><span class="size">縦30cm×横40cm</span></div>
      </div>
      <div class="brand"><img src="../assets/rootlens_R.png" alt=""><span>RootLens</span></div>
    </div>

  </div>
</div>

<div class="page">
  <div class="grid">

    <!-- No.11 矩形 90×60cm: 表示 36×24mm / ミニマーカーはデフォルメ -->
    <div class="sticker">
      <img class="aruco" src="../assets/ng/aruco-11.png" alt="">
      <div class="strip">
        <svg class="diagram" style="height:18mm" width="42mm" height="26mm" viewBox="0 0 42 26">
          <rect x="2" y="1" width="36" height="24" fill="url(#mosaic)" stroke="#111" stroke-width="0.45"/>
          <line x1="4.4" y1="23" x2="35.6" y2="23" stroke="#111" stroke-width="0.3"
                marker-start="url(#arrR)" marker-end="url(#arr)"/>
          <line x1="36" y1="3.4" x2="36" y2="22.6" stroke="#111" stroke-width="0.3"
                marker-start="url(#arrR)" marker-end="url(#arr)"/>
          <image href="../assets/ng/aruco-11.png" x="16.5" y="9.5" width="7" height="7"/>
          <line x1="16.2" y1="11.1" x2="18.1" y2="9.2" stroke="#fff" stroke-width="0.55"/>
        </svg>
        <div class="dim"><span class="ttl">ぼかしシール</span><span class="size">縦60cm×横90cm</span></div>
      </div>
      <div class="brand"><img src="../assets/rootlens_R.png" alt=""><span>RootLens</span></div>
    </div>

    <!-- No.12 矩形 180×90cm: 表示 44×22mm / ミニマーカーはデフォルメ -->
    <div class="sticker">
      <img class="aruco" src="../assets/ng/aruco-12.png" alt="">
      <div class="strip">
        <svg class="diagram" style="height:16mm" width="48mm" height="26mm" viewBox="0 0 48 26">
          <rect x="2" y="2" width="44" height="22" fill="url(#mosaic)" stroke="#111" stroke-width="0.45"/>
          <line x1="4.4" y1="22" x2="43.6" y2="22" stroke="#111" stroke-width="0.3"
                marker-start="url(#arrR)" marker-end="url(#arr)"/>
          <line x1="44" y1="4.4" x2="44" y2="21.6" stroke="#111" stroke-width="0.3"
                marker-start="url(#arrR)" marker-end="url(#arr)"/>
          <image href="../assets/ng/aruco-12.png" x="20.5" y="9.5" width="7" height="7"/>
          <line x1="20.2" y1="11.1" x2="22.1" y2="9.2" stroke="#fff" stroke-width="0.55"/>
        </svg>
        <div class="dim"><span class="ttl">ぼかしシール</span><span class="size">縦90cm×横180cm</span></div>
      </div>
      <div class="brand"><img src="../assets/rootlens_R.png" alt=""><span>RootLens</span></div>
    </div>

  </div>
</div>

</body>
</html>
