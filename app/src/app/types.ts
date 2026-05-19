// Navigation 型定義。
//
// アプリは大きく 2 階層:
//   • RootStack — Login (初回) → MainTabs (= ベース) → TaskBriefing → Capture (撮影終了で Main に戻る)
//   • MainTabs  — Job / Collection / Settings の 3 タブ
//
// 撮影フロー (= TaskBriefing と Capture) は Tab の上に被せる stack screen。
// 撮影完了時は popToTop で Main の Collection タブに自動的に戻る。
// Review / SignAndMint / Stake / Done は廃止 (= SPECS_JA §2.7 のクリップ状態機械で Collection に統合)。

export type RootStackParamList = {
  Login: undefined;
  Main: undefined; // MainTabs を埋め込むコンテナ画面
  TaskBriefing: { taskId: string };
  Capture: { taskId: string };
};

export type MainTabParamList = {
  Job: undefined;
  Collection: undefined;
  Settings: undefined;
};
