// 開発者用データフロー確認サンドボックス (Layer 3 = UI)。
//
// 目的: UI フローから完全に独立した状態で、 単体クリップのデータフロー
// (録画 → Pipeline 1 → Pipeline 2 → Pipeline 3) を 1 ボタンずつ叩いて検証する。
// 本番 UI (RootNavigator 配下の screens) とは別系統。 __DEV__ 時に App.tsx がこれをルートにする。
//
// このファイルは UI 層なので react / react-native / zustand binding を自由に使う。
// データフローのロジックは一切持たず、 dataflow 層 (Layer 1) の step / orchestrator を呼ぶだけ。

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from 'zustand';

import {
  DEFAULT_RECORDING_CONFIG,
  RECORDING_CONFIGS,
  getRecordingConfig,
  dataflowStore,
  storeEventSink,
  teeToConsole,
  enqueueRecording,
  advanceClip,
  selectCurrentClip,
  type DataflowEvent,
  type EventLevel,
  type RecordingConfig,
} from '../dataflow';
import { WideCapturePreviewView } from '../native/wideCapture';
import { ArkitCapturePreviewView } from '../native/arkitCapture';
// console にもミラーする sink (= Metro ログでも追える)
const sink = teeToConsole(storeEventSink, 'sandbox');

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try { return JSON.stringify(e); } catch { return String(e); }
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// 構成切替時にカメラが解放されるのを待つ猶予 (= AVCaptureSession を stop してから
// ARSession を start するまでの間。 カメラは排他リソースなので、 即座に貼り直すと
// FigCaptureSession が衝突してクラッシュする)。
const CAMERA_RELEASE_DELAY_MS = 450;

const LEVEL_COLOR: Record<EventLevel, string> = {
  info: '#8aa0b6',
  success: '#5fd07a',
  warn: '#e0b341',
  error: '#ff6b6b',
};

export const DevSandboxScreen: React.FC = () => {
  const insets = useSafeAreaInsets();

  // 撮影構成は切替可能 (= ultra_wide ⇄ arkit)。録画待機中のみ切替できる。
  // selectedConfigId = ユーザーが選んだ構成 (切替の目標)。
  // activeConfigId   = 実際に session が稼働中の構成 (= 切替完了後に更新)。preview / 録画はこちらを使う。
  const [selectedConfigId, setSelectedConfigId] = useState<string>(DEFAULT_RECORDING_CONFIG.id);
  const [activeConfigId, setActiveConfigId] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const config = getRecordingConfig(selectedConfigId) ?? DEFAULT_RECORDING_CONFIG;
  // session 操作 (start/stop) はカメラ排他のため絶対に重ねない。 直列化用の promise チェーン。
  const sessionOpRef = useRef<Promise<void>>(Promise.resolve());
  // 現在 session が稼働中の config (= 次の切替で stop する対象)。null なら未稼働。
  const runningConfigRef = useRef<RecordingConfig | null>(null);

  const events = useStore(dataflowStore, (s) => s.events);
  const recording = useStore(dataflowStore, (s) => s.recording);
  // 進行中クリップ (= currentClipId が指すもの)。 段の進行 / server 状態はここにマージされる。
  const clip = useStore(dataflowStore, selectCurrentClip);
  const busy = useStore(dataflowStore, (s) => s.busy);

  const [available, setAvailable] = useState<boolean | null>(null);
  // 全撮影構成の利用可否 (= スイッチャの活性判定)。
  const [availByConfig, setAvailByConfig] = useState<Record<string, boolean>>({});
  const logRef = useRef<ScrollView>(null);

  // 起動時に 1 度だけ、 全撮影構成の利用可否を判定する (= スイッチャ表示用)。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        RECORDING_CONFIGS.map(
          async (c) => [c.id, await c.isAvailable().catch(() => false)] as const,
        ),
      );
      if (!cancelled) setAvailByConfig(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, []);

  // 撮影構成の session ハンドオフ。 config が変わるたびに「旧 session を完全停止 (await) →
  // カメラ解放待ち → 新 session を開始」を直列で実行する。
  // ⚠ useEffect cleanup に stop を任せると stop が await されず新 start と race し、
  //    AVCaptureSession ↔ ARSession がカメラ (排他リソース) を奪い合って FigCaptureSession が
  //    クラッシュする。 そのため sessionOpRef の promise チェーンで明示的に直列化する。
  useEffect(() => {
    let cancelled = false;
    const target = config;
    sessionOpRef.current = sessionOpRef.current
      .then(async () => {
        if (cancelled) return;
        const running = runningConfigRef.current;
        if (running && running.id === target.id) return; // 既に稼働中

        const ok = await target.isAvailable().catch(() => false);
        if (cancelled) return;
        setAvailable(ok);
        if (!ok) {
          sink({ step: 'sandbox', level: 'warn', message: `撮影構成 ${target.id} は当端末で利用不可 (シミュレータ?)` });
          return;
        }

        setSwitching(true);
        // 1) 旧 session を完全停止 (await) → カメラ解放を待つ
        if (running) {
          await running.stopSession(sink).catch((e) =>
            sink({ step: 'sandbox', level: 'warn', message: `旧 session 停止: ${errMsg(e)}` }),
          );
          runningConfigRef.current = null;
          setActiveConfigId(null);
          dataflowStore.getState().setRecording('idle');
          await delay(CAMERA_RELEASE_DELAY_MS);
          if (cancelled) return;
        }
        // 2) 新 session を開始
        dataflowStore.getState().setConfigId(target.id);
        await target.startSession(sink);
        runningConfigRef.current = target;
        if (cancelled) return;
        setActiveConfigId(target.id);
        dataflowStore.getState().setRecording('session-active');
      })
      .catch((e) =>
        sink({ step: 'sandbox', level: 'error', message: `session 切替失敗: ${errMsg(e)}` }),
      )
      .finally(() => {
        if (!cancelled) setSwitching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config]);

  // アンマウント時に稼働中 session を停止する。
  useEffect(() => {
    return () => {
      const running = runningConfigRef.current;
      runningConfigRef.current = null;
      if (running) running.stopSession(sink).catch(() => {});
    };
  }, []);

  // イベント追加で末尾へ自動スクロール
  useEffect(() => {
    const t = setTimeout(() => logRef.current?.scrollToEnd({ animated: true }), 30);
    return () => clearTimeout(t);
  }, [events.length]);

  const runAction = useCallback(async (label: string, fn: () => Promise<void>) => {
    const store = dataflowStore.getState();
    if (store.busy) return;
    store.setBusy(label);
    try {
      await fn();
    } catch (e) {
      sink({ step: 'sandbox', level: 'error', message: `${label} 失敗: ${errMsg(e)}` });
    } finally {
      dataflowStore.getState().setBusy(null);
    }
  }, []);

  // ─── ハンドラ ─────────────────────────────────────────────────────

  // 撮影構成の切替 (= 録画待機中のみ)。 config が変わると session useEffect が
  // 旧 session を stop → 新 config で start し直す。
  const onSelectConfig = useCallback((id: string) => {
    const st = dataflowStore.getState();
    if (st.busy || (st.recording !== 'idle' && st.recording !== 'session-active')) return;
    setSelectedConfigId(id);
  }, []);

  const onStartRecording = useCallback(() => {
    runAction('録画開始', async () => {
      const session = await config.startRecording(sink);
      const store = dataflowStore.getState();
      store.setSession(session);
      store.resetCurrent(); // 新しい録画 = 前の署名 + 進行中クリップ追跡を破棄
      store.setRecording('recording');
    });
  }, [config, runAction]);

  // 録画停止 → クリップを起こす (= stage 'pending'、 local id で進行表示対象に)。
  // 署名は「Pipeline 実行」 (= advanceClip) の段で行われる (= 失敗段から再開できる)。
  const onStopRecording = useCallback(() => {
    runAction('録画停止', async () => {
      const session = await config.stopRecording(sink);
      const store = dataflowStore.getState();
      store.setSession(session);
      await enqueueRecording({ config, session });
      store.setRecording('recorded');
    });
  }, [config, runAction]);

  // Pipeline 実行 = 段レジュームランナー (advanceClip)。 pending → hash (content_hash 誕生)
  // → R2 upload → POST /api/clips まで一気に駆動する。
  // 失敗した段は clip.state='error' に反映され、 もう一度押すとその段から再開する。
  const onRunPipeline1 = useCallback(() => {
    runAction('Pipeline 実行 (段レジューム)', async () => {
      const clipId = dataflowStore.getState().currentClipId;
      if (!clipId) {
        sink({ step: 'sandbox', level: 'error', message: 'クリップがありません。 先に録画 → 停止してください' });
        return;
      }
      await advanceClip(clipId, sink);
    });
  }, [runAction]);

  // ─── render ───────────────────────────────────────────────────────

  const canRecord = available === true && recording === 'session-active';
  const canStop = recording === 'recording';
  const canRunP1 = recording === 'recorded' && !!clip?.id;
  const hasClip = !!clip?.id;
  const canSwitchConfig = !busy && !switching && (recording === 'idle' || recording === 'session-active');
  // プレビューは「実際に稼働中の構成」の native view を出す (= 切替完了後に swap)。
  // 選択直後 (= session 起動前) に arkit の ARSCNView を mount するとカメラ競合になるため、
  // activeConfigId 基準にして session ハンドオフ完了まで preview を貼り替えない。
  // native 未登録 (= 未ビルド) なら null。
  const PreviewView =
    activeConfigId === 'arkit'
      ? ArkitCapturePreviewView
      : activeConfigId === 'ultra_wide'
        ? WideCapturePreviewView
        : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>DATAFLOW SANDBOX</Text>
        <Text style={styles.sub}>
          {config.label} · {recording}
          {available === false ? ' · 端末非対応' : ''}
        </Text>
        {/* 撮影構成スイッチャ (= 録画待機中のみ切替可) */}
        <View style={styles.switcher}>
          {RECORDING_CONFIGS.map((c) => {
            const selected = c.id === config.id;
            const avail = availByConfig[c.id];
            const disabled = avail === false || !canSwitchConfig || selected;
            return (
              <Pressable
                key={c.id}
                onPress={() => onSelectConfig(c.id)}
                disabled={disabled}
                style={[
                  styles.configChip,
                  selected && styles.configChipSel,
                  avail === false && styles.configChipUnavail,
                ]}
              >
                <Text style={[styles.configChipText, selected && styles.configChipTextSel]}>
                  {c.id}{avail === false ? ' ✕' : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* プレビュー */}
      <View style={styles.preview}>
        {activeConfigId && PreviewView ? (
          <PreviewView style={StyleSheet.absoluteFill} />
        ) : (
          <View style={styles.previewPlaceholder}>
            <Text style={styles.placeholderText}>
              {switching
                ? `構成切替中… (→ ${config.id})`
                : available === null
                  ? '撮影構成を確認中…'
                  : available === false
                    ? `${config.id} は当端末で利用不可`
                    : 'プレビュー起動待ち…'}
            </Text>
          </View>
        )}
        {recording === 'recording' && (
          <View style={styles.recBadge}>
            <View style={styles.recDot} />
            <Text style={styles.recText}>REC</Text>
          </View>
        )}
      </View>

      {/* クリップ状態バー */}
      <View style={styles.statusBar}>
        <StatusRow label="clipId" value={clip?.id} />
        <StatusRow label="content_hash" value={clip?.contentHash} mono />
        <StatusRow label="stage" value={clip?.stage} />
        <StatusRow
          label="state"
          value={clip?.state}
          extra={clip?.uploadProgress != null ? `progress ${Math.round((clip.uploadProgress ?? 0) * 100)}%` : undefined}
        />
      </View>

      {/* イベントログ */}
      <ScrollView ref={logRef} style={styles.log} contentContainerStyle={styles.logContent}>
        {events.length === 0 ? (
          <Text style={styles.logEmpty}>イベントログ (ボタンを押すと進捗がここに出ます)</Text>
        ) : (
          events.map((e) => <LogLine key={e.id} event={e} />)
        )}
      </ScrollView>

      {/* ボタン群 (= 上から下が処理フロー順: 録画 → 送信) */}
      <View style={[styles.buttons, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.row}>
          <SandboxButton label="録画開始" onPress={onStartRecording} disabled={!canRecord || !!busy} />
          <SandboxButton label="録画停止" onPress={onStopRecording} disabled={!canStop || !!busy} />
        </View>
        {/* 送信 (= 署名 → R2 アップ → /api/clips 登録)。 v0.1.4 は後段ワーカー無し。 */}
        <View style={styles.row}>
          <SandboxButton label="送信 (署名 → アップロード → 登録)" onPress={onRunPipeline1} disabled={!canRunP1 || !!busy} primary />
        </View>
        <View style={styles.row}>
          <SandboxButton label="ログクリア" onPress={() => dataflowStore.getState().clearEvents()} disabled={!!busy} subtle />
          <SandboxButton label="リセット" onPress={() => dataflowStore.getState().reset()} disabled={!!busy} subtle />
        </View>
        {busy && (
          <View style={styles.busyBar}>
            <ActivityIndicator color="#5fd07a" size="small" />
            <Text style={styles.busyText}>{busy} 実行中…</Text>
          </View>
        )}
      </View>
    </View>
  );
};

// ─── 小コンポーネント ──────────────────────────────────────────────────

const StatusRow: React.FC<{ label: string; value?: string | null; mono?: boolean; extra?: string }> = ({
  label,
  value,
  mono,
  extra,
}) => (
  <View style={styles.statusRow}>
    <Text style={styles.statusLabel}>{label}</Text>
    <Text style={[styles.statusValue, mono && styles.monoText]} numberOfLines={1} ellipsizeMode="middle">
      {value ?? '—'}
      {extra ? `  (${extra})` : ''}
    </Text>
  </View>
);

const LogLine: React.FC<{ event: DataflowEvent }> = ({ event }) => (
  <View style={styles.logLine}>
    <Text style={styles.logTs}>{formatTs(event.ts)}</Text>
    <Text style={[styles.logStep, { color: LEVEL_COLOR[event.level] }]}>{event.step}</Text>
    <Text style={[styles.logMsg, { color: LEVEL_COLOR[event.level] }]}>{event.message}</Text>
  </View>
);

const SandboxButton: React.FC<{
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  subtle?: boolean;
}> = ({ label, onPress, disabled, primary, subtle }) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    style={[
      styles.btn,
      primary && styles.btnPrimary,
      subtle && styles.btnSubtle,
      disabled && styles.btnDisabled,
    ]}
  >
    <Text style={[styles.btnText, primary && styles.btnTextPrimary, disabled && styles.btnTextDisabled]}>
      {label}
    </Text>
  </Pressable>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  header: { paddingHorizontal: 16, paddingVertical: 8 },
  title: { color: '#e6edf3', fontSize: 16, fontWeight: '700', letterSpacing: 1 },
  sub: { color: '#8aa0b6', fontSize: 12, marginTop: 2 },
  switcher: { flexDirection: 'row', gap: 8, marginTop: 8 },
  configChip: {
    paddingVertical: 5, paddingHorizontal: 12, borderRadius: 14,
    backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d',
  },
  configChipSel: { backgroundColor: '#1f3a5f', borderColor: '#3b6ea5' },
  configChipUnavail: { opacity: 0.4 },
  configChipText: { color: '#8aa0b6', fontSize: 12, fontWeight: '600' },
  configChipTextSel: { color: '#cfe3ff' },

  preview: { height: 180, backgroundColor: '#000', margin: 12, borderRadius: 10, overflow: 'hidden' },
  previewPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  placeholderText: { color: '#566', fontSize: 13 },
  recBadge: {
    position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, gap: 6,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ff3b30' },
  recText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  statusBar: { marginHorizontal: 12, padding: 10, backgroundColor: '#161b22', borderRadius: 8, gap: 3 },
  statusRow: { flexDirection: 'row', alignItems: 'center' },
  statusLabel: { color: '#6e7d8f', fontSize: 11, width: 92 },
  statusValue: { color: '#c9d4df', fontSize: 12, flex: 1 },
  monoText: { fontFamily: 'Courier' },

  log: { flex: 1, marginHorizontal: 12, marginTop: 10, backgroundColor: '#0a0e13', borderRadius: 8 },
  logContent: { padding: 10 },
  logEmpty: { color: '#445', fontSize: 12, fontStyle: 'italic' },
  logLine: { flexDirection: 'row', marginBottom: 3, flexWrap: 'wrap' },
  logTs: { color: '#475', fontSize: 11, fontFamily: 'Courier', marginRight: 6 },
  logStep: { fontSize: 11, fontFamily: 'Courier', marginRight: 6, minWidth: 78 },
  logMsg: { fontSize: 12, fontFamily: 'Courier', flex: 1 },

  buttons: { paddingHorizontal: 12, paddingTop: 8, gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  btn: {
    flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center',
    backgroundColor: '#21262d', borderWidth: 1, borderColor: '#30363d',
  },
  btnPrimary: { backgroundColor: '#1f6f43', borderColor: '#2ea043' },
  btnSubtle: { backgroundColor: 'transparent', borderColor: '#30363d' },
  btnDisabled: { opacity: 0.35 },
  btnText: { color: '#c9d4df', fontSize: 13, fontWeight: '600' },
  btnTextPrimary: { color: '#fff' },
  btnTextDisabled: { color: '#6e7d8f' },

  busyBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 4 },
  busyText: { color: '#5fd07a', fontSize: 12 },
});
