import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { evaluateTaskGate, type TaskGateResult } from './geminiClient';

// Sandbox 02: VLM Task Gate
//
// 検証目的:
//   - Gemini API でスナップショット + タスク + 条件 → match/confidence/reason 構造化判定が動くか
//   - 複数タスク (洗濯畳み、皿洗い等) で精度が体感できるレベルか
//   - latency / cost (token 数) の実測値を記録
//
// 実装ノート:
//   - sandbox なので API key はテキスト入力 → AsyncStorage 保存。本番は SecureStore + 環境変数。
//   - 画像は CameraView.takePictureAsync の uri を base64 化して inlineData で送る。
//   - thinkingBudget は gemini-2.5+ で有効。Robotics-ER 1.6 の挙動はモデル依存。
//   - structured output で JSON parse 失敗を回避 (responseSchema)。

const STORAGE_KEY_MODEL = 'sandbox.vlm.model';
const STORAGE_KEY_TASK = 'sandbox.vlm.taskName';
const STORAGE_KEY_COND = 'sandbox.vlm.conditionText';

// Robotics-ER 1.6 は egocentric manipulation で訓練済み + task progress 判定が
// ネイティブ capability。task 02 README で選定根拠を整理済み。
// API key は .env の EXPO_PUBLIC_GEMINI_API_KEY から。手動 override も画面で可能。
const DEFAULT_MODEL = 'gemini-robotics-er-1.6';
const ENV_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '';

export default function TaskGateScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [apiKeyOverride, setApiKeyOverride] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [taskName, setTaskName] = useState('洗濯物を畳む');
  const [conditionText, setConditionText] = useState('両手と散らかった洗濯物が画面内に見える');

  const [snapshotUri, setSnapshotUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TaskGateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // env が無い時のための override (画面入力)。env がある場合は隠す。
  const apiKey = ENV_API_KEY || apiKeyOverride;

  useEffect(() => {
    (async () => {
      const [m, t, c] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY_MODEL),
        AsyncStorage.getItem(STORAGE_KEY_TASK),
        AsyncStorage.getItem(STORAGE_KEY_COND),
      ]);
      if (m) setModel(m);
      if (t) setTaskName(t);
      if (c) setConditionText(c);
    })();
  }, []);

  useEffect(() => { AsyncStorage.setItem(STORAGE_KEY_MODEL, model); }, [model]);
  useEffect(() => { AsyncStorage.setItem(STORAGE_KEY_TASK, taskName); }, [taskName]);
  useEffect(() => { AsyncStorage.setItem(STORAGE_KEY_COND, conditionText); }, [conditionText]);

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || busy) return;
    setError(null);
    setResult(null);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        skipProcessing: false,
      });
      if (photo?.uri) {
        setSnapshotUri(photo.uri);
      }
    } catch (e) {
      setError(`撮影失敗: ${(e as Error).message}`);
    }
  }, [busy]);

  const handleEvaluate = useCallback(async () => {
    if (!snapshotUri) { setError('先に撮影してください'); return; }
    if (!apiKey) { setError('API key を入力してください'); return; }
    if (!model) { setError('model を入力してください'); return; }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await evaluateTaskGate({
        apiKey,
        model: model.trim(),
        imageUri: snapshotUri,
        taskName: taskName.trim(),
        conditionText: conditionText.trim(),
      });
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [snapshotUri, apiKey, model, taskName, conditionText]);

  if (!permission) {
    return <View style={styles.center}><ActivityIndicator color="#fff" /></View>;
  }
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>カメラ権限が必要です</Text>
        <Pressable style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>許可する</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.cameraWrapper}>
          {snapshotUri ? (
            // 撮影済み: 画像プレビュー表示 (next take で消す)
            <PreviewSnapshot uri={snapshotUri} onRetake={() => setSnapshotUri(null)} />
          ) : (
            <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
          )}
        </View>

        <View style={styles.row}>
          {snapshotUri ? (
            <Pressable style={[styles.button, styles.buttonSecondary]} onPress={() => setSnapshotUri(null)}>
              <Text style={styles.buttonText}>撮り直し</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.button} onPress={handleCapture}>
              <Text style={styles.buttonText}>📸 スナップショット撮影</Text>
            </Pressable>
          )}
        </View>

        <Field label="タスク名" value={taskName} onChange={setTaskName} placeholder="洗濯物を畳む" />
        <Field
          label="判定条件"
          value={conditionText}
          onChange={setConditionText}
          placeholder="両手と散らかった洗濯物が画面内に見える"
          multiline
        />

        <Field
          label={`model (default: ${DEFAULT_MODEL})`}
          value={model}
          onChange={setModel}
        />
        {ENV_API_KEY ? (
          <Text style={styles.envHint}>API key: .env (EXPO_PUBLIC_GEMINI_API_KEY) を使用</Text>
        ) : (
          <Field
            label="Gemini API key (.env 未設定 — 一時 override)"
            value={apiKeyOverride}
            onChange={setApiKeyOverride}
            secureTextEntry
          />
        )}

        <Pressable
          style={[styles.button, styles.buttonPrimary, (busy || !snapshotUri) && styles.buttonDisabled]}
          onPress={handleEvaluate}
          disabled={busy || !snapshotUri}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>判定する</Text>}
        </Pressable>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {result ? <ResultBox result={result} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const PreviewSnapshot: React.FC<{ uri: string; onRetake: () => void }> = ({ uri }) => (
  <View style={StyleSheet.absoluteFill}>
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />
    {/* react-native の Image を使うと expo-image との依存衝突を避けつつ動く */}
    {/* eslint-disable-next-line @typescript-eslint/no-require-imports */}
    {React.createElement(require('react-native').Image, {
      source: { uri },
      style: StyleSheet.absoluteFill,
      resizeMode: 'cover',
    })}
  </View>
);

const Field: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  secureTextEntry?: boolean;
}> = ({ label, value, onChange, placeholder, multiline, secureTextEntry }) => (
  <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput
      style={[styles.fieldInput, multiline && styles.fieldInputMulti]}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor="#666"
      multiline={multiline}
      secureTextEntry={secureTextEntry}
      autoCapitalize="none"
      autoCorrect={false}
    />
  </View>
);

const ResultBox: React.FC<{ result: TaskGateResult }> = ({ result }) => (
  <View style={[styles.resultBox, result.match ? styles.resultMatch : styles.resultNoMatch]}>
    <Text style={styles.resultHeadline}>
      {result.match ? '✅ 条件を満たす' : '❌ 条件を満たさない'}
      {`  (${(result.confidence * 100).toFixed(0)}%)`}
    </Text>
    <Text style={styles.resultReason}>{result.reason}</Text>
    <Text style={styles.resultMeta}>
      latency: {result.latencyMs} ms
      {result.promptTokens != null ? `  ·  in: ${result.promptTokens} tok` : ''}
      {result.candidatesTokens != null ? `  ·  out: ${result.candidatesTokens} tok` : ''}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  scroll: { padding: 16, gap: 12, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#000', gap: 12 },
  text: { color: '#fff', fontSize: 14, textAlign: 'center' },

  cameraWrapper: {
    height: 280,
    backgroundColor: '#222',
    borderRadius: 12,
    overflow: 'hidden',
  },

  row: { flexDirection: 'row', gap: 8 },

  field: { gap: 4 },
  fieldLabel: { color: '#888', fontSize: 11 },
  fieldInput: {
    backgroundColor: '#1a1a1a',
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    fontSize: 14,
  },
  fieldInputMulti: { minHeight: 64, textAlignVertical: 'top' },

  envHint: { color: '#6ee7b7', fontSize: 11, paddingHorizontal: 4 },

  button: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#333',
    alignItems: 'center',
    flex: 1,
  },
  buttonPrimary: { backgroundColor: '#0ea5e9' },
  buttonSecondary: { backgroundColor: '#444' },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  errorBox: { backgroundColor: '#7f1d1d', borderRadius: 8, padding: 12 },
  errorText: { color: '#fff', fontSize: 13 },

  resultBox: { borderRadius: 8, padding: 12, gap: 6 },
  resultMatch: { backgroundColor: '#064e3b' },
  resultNoMatch: { backgroundColor: '#7c2d12' },
  resultHeadline: { color: '#fff', fontSize: 15, fontWeight: '700' },
  resultReason: { color: '#fff', fontSize: 13, lineHeight: 18 },
  resultMeta: { color: '#bbb', fontSize: 11, marginTop: 4 },
});
