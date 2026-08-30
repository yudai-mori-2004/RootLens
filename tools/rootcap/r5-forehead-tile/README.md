# RootCap R5 forehead tile

額へ密着する曲面だけを確認するための、黒PLA一体成形の初回フィットモデル。45度支持部、MagSafe、ストラップ穴はまだ含めない。

## 初期寸法

- 幅: 96 mm
- 高さ: 44 mm
- 中央厚さ: 2.6 mm
- 角丸: 8 mm
- 横方向の局所曲率半径: 95 mm
- 縦方向の局所曲率半径: 約130 mm

横方向95 mmは成人用ヘッドフォームの額付近を想定した開始値で、個人専用のスキャン形状ではない。初回は黒PLA一枚だけで形状を確認する。試着後は `forehead_radius_x`、`forehead_radius_z`、`tile_width`、`tile_height` を変更する。

## 出力

- `stl/forehead_tile_medium.stl`: 額当て一枚板
- `review/tile-isometric.png`: 単体形状
- `review/fit-front.png`: 仮想頭部に対する正面位置
- `review/fit-side.png`: 仮想頭部との接触断面

## 生成

```sh
tools/rootcap/r5-forehead-tile/build.sh
```

初回は黒PLA、0.20 mm層、外周4層以上でよい。曲面部品のため、額に触れる凹面を上にして通常サポートを付ける。サポート痕は外側へ寄せ、額側は滑らかに仕上げる。装着前に角とバリを取り、まず短時間だけ試着する。
