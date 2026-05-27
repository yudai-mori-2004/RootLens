import { useEffect } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';
import type { TaskOrientation } from '../domain/taskCatalog';

// 撮影画面用 orientation lock。
//
// アプリ起動時に App.tsx で 1 度 PORTRAIT_UP に lock 済み (= 全 screen 共通の baseline)。
// 撮影画面では task の orientation に override し、 unmount で portrait に戻す。
// これにより capture 以外の画面は何もしなくても portrait のままになる。
//
// landscape は LEFT / RIGHT 両許可 (= mount を左右どちら向きに付けても OK)。
// 実際の LEFT / RIGHT は OS が自動で選び、 capture 内では別途 listener で実値を取得して
// native (ARKit / Vision) に伝える。
//
// **重要**: 「orientation 変化時の effect 切替」 と 「画面 unmount 時のリセット」 は別の
// useEffect に分ける。 1 つにまとめて cleanup で PORTRAIT_UP に戻すと、 task=null→landscape
// 切替時に [cleanup(portrait), effect(landscape)] が両方走り、 lockAsync は async なので
// 順序が崩れて PORTRAIT_UP が後勝ちで定着するレース条件を踏む (= landscape task が
// portrait で開いてしまう)。
export function useCaptureOrientationLock(orientation: TaskOrientation): void {
  // orientation が変化したら lock を切替える。 cleanup は持たない (= レース回避)。
  useEffect(() => {
    const target =
      orientation === 'landscape'
        ? ScreenOrientation.OrientationLock.LANDSCAPE
        : ScreenOrientation.OrientationLock.PORTRAIT_UP;
    ScreenOrientation.lockAsync(target).catch(() => {});
  }, [orientation]);

  // unmount 時のみ portrait に戻す。 deps を空配列にして cleanup を 「画面破棄時」 限定に。
  useEffect(() => {
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);
}
