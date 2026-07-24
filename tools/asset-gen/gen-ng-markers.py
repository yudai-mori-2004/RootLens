# 撮影禁止マーカー (= ぼかしマーカー) の ArUco 画像を生成する。
#
# 納品パイプライン (tools/modal/fpvlabs/fpvlabs.py) が DICT_4X4_50 を検出し、 マーカー周囲の
# 実寸ゾーンをぼかす。 id → ゾーンの対応は fpvlabs.py の NG_MARKER_ZONES が正。
#
# ここで出すのはマーカー画像だけで、 ステッカーの紙面は
# document/business/templates/data-cooperation/ng-markers.html が組む (= 他の配布物と同じ
# build.sh → PDF の系統)。 印刷時の黒枠実寸 70mm は HTML 側の width:70mm が保証する。
#
# 使い方: python3 tools/asset-gen/gen-ng-markers.py
# 出力:   document/business/templates/assets/ng/aruco-<id>.png (300dpi 相当 828px)

from __future__ import annotations

import os

import cv2

MARKER_IDS = [0, 1, 2, 10, 11, 12]  # fpvlabs.py NG_MARKER_ZONES と 1:1
MARKER_PX = 828  # 70mm @300dpi ≒ 827px。 6 セルの倍数に丸めてモジュール境界を整数に保つ


def main() -> None:
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    out_dir = os.path.join(repo_root, "document", "business", "templates", "assets", "ng")
    os.makedirs(out_dir, exist_ok=True)

    aruco = cv2.aruco
    dictionary = aruco.getPredefinedDictionary(aruco.DICT_4X4_50)
    gen = aruco.generateImageMarker if hasattr(aruco, "generateImageMarker") else aruco.drawMarker
    for mid in MARKER_IDS:
        out_path = os.path.join(out_dir, f"aruco-{mid}.png")
        cv2.imwrite(out_path, gen(dictionary, mid, MARKER_PX))
        print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
