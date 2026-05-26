// Navigation 型定義。
//
// アプリは大きく 2 階層 (UI_SPECS_JA §2):
//   • RootStack — Login (初回) → MainTabs (= ベース) → TaskBriefing → Capture
//                (撮影終了で Main に戻る)
//   • MainTabs  — Home / Camera / Settings の 3 タブ (= UI_SPECS_JA §2.1)
//
// 撮影フロー (= TaskBriefing と Capture) は Tab の上に被せる stack screen。
// Capture 完了時は popToTop で Main の Home タブに自動的に戻る。
// Camera タブのタップは「撮影モードに入る」 アクションで、 専用 screen ではない
// (= dialogue submode が独立画面として実装される task 14 までは TaskBriefing を直接 push)。

export type RootStackParamList = {
  Login: undefined;
  Main: undefined; // MainTabs を埋め込むコンテナ画面
  TaskBriefing: { taskId: string };
  Capture: { taskId: string };
};

export type MainTabParamList = {
  Home: undefined;
  Camera: undefined;   // タップで撮影モードを起動する trigger 専用 (画面自体は placeholder)
  Settings: undefined;
};
