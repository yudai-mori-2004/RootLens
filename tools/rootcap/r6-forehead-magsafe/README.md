# RootCap R6 fixed 45-degree MagSafe plate

R5の96 × 44 mm額当て曲面を変更せず再利用し、その中央下部に幅70 mm・前方長さ81 mm・厚さ6 mmの板を一体化した黒PLA用モデル。装着時に全体が上を向く実測傾向を相殺するため、造形上の板角度は35度とし、装着時45度を狙う。中央断面はカタカナの「レ」形状になる。

板の内側表面には直径58 mm・深さ4 mmの円形窪みを設ける。窪みの手前端は17 mmのまま維持し、円の先に6 mmの縁を残して全周が板上に収まる。

額当てにはM4ねじ用の直径4.5 mm貫通穴を、四隅と上辺中央の計5か所に設ける。

支持部は補強リブや別の塊を追加せず、額板と元の6 mm板の間を連続ロフトで溶かした形状とする。内側は額曲面から45度のスマホ設置面へ接線を合わせた曲線で移行する。板本体の根元はロフト内部まで切り戻し、内側へ角が露出しない。外側も曲線で移行し、額パッド下端と同じ高さに幅69 mmの水平面を形成するため、線や角だけで荷重を受けない。

実行: `tools/rootcap/r6-forehead-magsafe/build.sh`

出力: `tools/rootcap/r6-forehead-magsafe/stl/forehead_magsafe_mount.stl`

## 3穴・薄型額当ての派生版

2個並ぶ穴の列を取り除いて3個の列を残し、額接触部の厚さを2.6 mmから2.0 mmへ薄くした派生版。円曲面と連続ロフトの分割数もR6より増やし、印刷形状を滑らかにする。MagSafe板、窪み、角度、それ以外の外形はR6と同じとする。

実行: `tools/rootcap/r6-forehead-magsafe/build_three_hole_thin.sh`

出力: `tools/rootcap/r6-forehead-magsafe/stl/forehead_magsafe_mount_three_hole_thin.stl`

## R7 額曲面の置換版

Blenderで作ったR7外形から旧額当てと額方向の食い込みを楕円体マスクで一度すべて除去し、R5と同じ額楕円から生成した新しい接触面へ置き換える。接触面は厚さ2.0 mm、幅96 mm、3穴を維持する。穴はM4用の直径4.5 mm貫通穴とし、額に接する内側の面には直径8.4 mm・深さ1.0 mmのねじ頭用窪みを設ける。左右の傾斜部でも外側へ貫通しないよう、窪みの底は額楕円へ追従させる。上側の角は半径8 mm、下端は角丸なしとする。三角形化の弦誤差を含めても額へ食い込まないよう、接触面全体を理論額面から0.10 mm外側へ置く。

曲面と除去マスクの正本: `RootaCap_R7_forehead_replacement.scad`

結合処理: `rebuild_r7_forehead.py`

STL書き出し後の局所的な退化面修復: `repair_r7_export.py`

手調整済みSTLの外形を再生成せず、3個のねじ頭用窪みだけを反対面へ移す処理: `flip_r7_counterbores_manifold.py`

最終出力:

- `stl/RootaCap_R7_forehead_rebuilt_counterbore_final.stl`
- `RootaCap_R7_forehead_rebuilt_counterbore_final.blend`
