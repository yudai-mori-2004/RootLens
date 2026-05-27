// Navigation 型定義 (UI_SPECS_JA §2)。
//
// アプリは大きく 2 階層:
//   • RootStack — Login (初回) → MainTabs (= ベース) → CaptureMode (= フルスクリーン)
//   • MainTabs  — Home / Camera / Settings の 3 タブ (= UI_SPECS_JA §2.1)
//
// Camera タブを押すと RootStack の `CaptureMode` を push する。 CaptureMode は
// 「対話サブモード」 と 「カメラサブモード」 を 1 画面内で切り替える (= UI_SPECS §2.2)。
// 視覚的断絶を作らないため、 旧 TaskBriefing / Capture の 2 画面遷移はやめて単一画面に。
// 撮影完了で対話サブモードに戻り、 ループ可能。 「終わり」 または戻るボタンで Home に戻る。

export type RootStackParamList = {
  Onboarding: undefined;     // 初回起動の welcome + ToS 同意 (UI_SPECS §9)
  Login: undefined;
  Main: undefined;           // MainTabs を埋め込むコンテナ画面
  CaptureMode: undefined;    // 対話 + カメラサブモード統合 (UI_SPECS §4 + §5)
};

export type MainTabParamList = {
  Home: undefined;
  Camera: undefined;   // tap で CaptureMode を push する trigger 専用 (画面自体は dummy)
  Settings: undefined;
};
