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
export function useCaptureOrientationLock(orientation: TaskOrientation): void {
  useEffect(() => {
    const target =
      orientation === 'landscape'
        ? ScreenOrientation.OrientationLock.LANDSCAPE
        : ScreenOrientation.OrientationLock.PORTRAIT_UP;
    ScreenOrientation.lockAsync(target).catch(() => {});
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, [orientation]);
}
