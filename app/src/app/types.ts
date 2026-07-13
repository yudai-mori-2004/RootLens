// Navigation 型定義。
//
// アプリは大きく 2 階層:
//   • RootStack — MainTabs (= ベース、 起動画面) / Login (= アップロード時・設定・QR から) /
//                 CaptureMode (= フルスクリーン)
//   • MainTabs  — Home / Camera / Settings の 3 タブ
//
// Camera タブを押すと RootStack の `CaptureMode` を push する。 CaptureMode は
// 「対話サブモード」 と 「カメラサブモード」 を 1 画面内で切り替える。
// 視覚的断絶を作らないため、 旧 TaskBriefing / Capture の 2 画面遷移はやめて単一画面に。
// 撮影完了で対話サブモードに戻り、 ループ可能。 「終わり」 または戻るボタンで Home に戻る。

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;           // MainTabs を埋め込むコンテナ画面
  CaptureMode: undefined;    // 対話 + カメラサブモード統合
};

export type MainTabParamList = {
  Home: undefined;
  Camera: undefined;   // tap で CaptureMode を push する trigger 専用 (画面自体は dummy)
  Settings: undefined;
};
