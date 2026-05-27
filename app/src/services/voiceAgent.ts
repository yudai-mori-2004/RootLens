// 撮影モード対話 AI エージェント (UI_SPECS_JA §4.4 / §8)。
//
// ユーザ発話 (= text または STT 結果) と DeviceContext を Claude Haiku 4.5 に渡し、
// 応答 text + action JSON を受け取る。 action でアプリ状態遷移を駆動する。
//
// v0.1.3 では:
//   ✅ Brain      = Claude Haiku 4.5 直接呼び出し (= EXPO_PUBLIC_ANTHROPIC_API_KEY)
//   ✅ TTS        = expo-speech (AVSpeechSynthesizer)
//   ⏳ Wake word  = sherpa-onnx 別タスク。 暫定: text input field でフォールバック
//   ⏳ STT        = sherpa-onnx 同上
//
// 設計方針 (= 仕様準拠):
//   - 1 応答 3 文以内、 短くフレンドリー (= ヘッドマウント装着時の聴取前提)
//   - JSON モード強制 (= response_text + action 構造化)
//   - DeviceContext + タスクカタログを system prompt に固定で焼き付け
//   - 履歴は 4 ターン (= ユーザ 4 + AI 4) で truncate (= context 肥大防止)

import * as Speech from 'expo-speech';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { ANTHROPIC_API_KEY } from '../env';
import { TASKS, type TaskDef } from '../domain/taskCatalog';
import { getVoiceLanguage, type VoiceLanguage } from './voicePref';

// ─── 型定義 ─────────────────────────────────────────────────────────────

export type ActionType =
  | 'task_matched'           // タスクがマッチ。 task_id を含む
  | 'start_recording'        // ユーザが撮影開始を指示
  | 'end_session'            // ユーザが「終わり」 を指示
  | 'info_response'          // 情報提供のみ、 状態遷移なし
  | 'clarification_needed';  // 意図不明、 追加質問

export interface AgentAction {
  type: ActionType;
  task_id?: string;                  // task_matched / start_recording 時
  await_user_confirmation?: boolean; // task_matched で「基準確認します?」 等
}

export interface AgentResponse {
  response_text: string;
  action: AgentAction;
}

export interface DeviceContext {
  device_model: string;
  os_version: string;
  app_version: string;
  has_lidar: boolean;

  orientation: 'portrait' | 'landscape_left' | 'landscape_right' | 'upside_down';
  battery_level: number | null;
  battery_charging: boolean | null;
  storage_available_gb: number | null;
  network_status: 'wifi' | 'cellular' | 'offline' | null;

  tracking_state: 'not_available' | 'limited' | 'normal';
  hands_detected: { left: boolean; right: boolean };

  selected_task: string | null;
  clips_recorded_this_session: number;
  current_mode: 'dialogue' | 'camera';
}

export interface AgentTurn {
  role: 'user' | 'assistant';
  text: string;
}

// ─── DeviceContext 取得 ────────────────────────────────────────────────

/// 端末固有情報 (= 起動中変わらないもの)。 起動時に 1 度だけ取れば良い。
let cachedStaticContext: Pick<DeviceContext, 'device_model' | 'os_version' | 'app_version' | 'has_lidar'> | null = null;

function getStaticContext() {
  if (cachedStaticContext) return cachedStaticContext;
  cachedStaticContext = {
    device_model: Device.modelName ?? Device.modelId ?? 'unknown',
    os_version: `${Device.osName ?? Platform.OS} ${Device.osVersion ?? ''}`.trim(),
    app_version: (Constants.expoConfig?.version as string | undefined) ?? '0.1.3',
    // LiDAR 判定は粗い: Pro 系 model name に "Pro" が含まれるかで暫定。 ARKit
    // から正確に取るには別 native module 要、 ここでは雑い heuristic。
    has_lidar: /pro/i.test(Device.modelName ?? ''),
  };
  return cachedStaticContext;
}

export function buildDeviceContext(opts: {
  orientation: DeviceContext['orientation'];
  tracking_state: DeviceContext['tracking_state'];
  hands_detected: DeviceContext['hands_detected'];
  selected_task: string | null;
  clips_recorded_this_session: number;
  current_mode: DeviceContext['current_mode'];
}): DeviceContext {
  return {
    ...getStaticContext(),
    ...opts,
    // expo-battery / expo-network が無いので暫定 null。 後で wiring。
    battery_level: null,
    battery_charging: null,
    storage_available_gb: null,
    network_status: null,
  };
}

// ─── System prompt ─────────────────────────────────────────────────────

function buildRolePrompt(lang: VoiceLanguage): string {
  if (lang === 'en') {
    return `You are "Hey Lens", the RootLens recording assistant. The user is a creator who films household chores to sell as training data.
Your role: help them pick a task, guide the recording flow, and surface device-state warnings.

Response style:
- Short, friendly. Max 3 sentences per reply.
- The user hears you through a head-mounted phone, so avoid jargon and keep cadence natural.
- ALWAYS return JSON (response_text + action). No prose, no markdown.
- response_text must be in English.`;
  }
  return `あなたは RootLens の撮影アシスタント「ヘイレンズ」 です。 ユーザは家事を撮影してデータセットとして売る撮影者。
役割: タスク選択、 撮影手順案内、 デバイス状況に基づく注意喚起。

応答スタイル:
- 短く、 フレンドリーに。 1 応答 3 文以内。
- ヘッドマウント装着中に聞かれるので、 専門用語を避け、 句読点でリズムをつける。
- 必ず JSON で返答 (response_text + action)。 prose や markdown は禁止。
- response_text は日本語で。`;
}

function buildTaskListPrompt(): string {
  const lines = TASKS.map((t) => {
    return `  - ${t.id} (${t.name}): ${t.blurb} 開始=${t.startCondition.slice(0, 60)}… 終了=${t.endCondition.slice(0, 60)}…`;
  });
  return `現在有効な撮影タスク (= id とその内容):\n${lines.join('\n')}`;
}

const DEVICE_CONTEXT_RULES = `DeviceContext の使い方:
- orientation が選択タスクと不一致なら 「向きを変えてください」 と案内
- tracking_state == 'limited' なら 「ARKit のトラッキングが不安定です」 と案内
- hands_detected が両方 false の長時間 (= 撮影中なら) 「両手をフレーム内に」 と案内
- battery_level が 0.2 未満なら充電を提案

action type の選び方:
- task_matched         ユーザが特定タスクを口にした (= task_id を返す)
- start_recording      ユーザが「始めて」 「OK」 等で開始指示
- end_session          ユーザが「終わり」 「もういい」 等で終了指示
- info_response        情報提供のみ (= 撮影基準の説明、 状態説明)
- clarification_needed 意図不明 (= 「もう一度言って」 等を返す)

必ずこの形式で返す:
{"response_text": "短い返答", "action": {"type": "...", ...}}`;

function buildSystemPrompt(lang: VoiceLanguage): string {
  return [buildRolePrompt(lang), '', buildTaskListPrompt(), '', DEVICE_CONTEXT_RULES].join('\n');
}

// ─── Claude Haiku 呼び出し ────────────────────────────────────────────

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 400;
const MAX_HISTORY_TURNS = 4;

export async function callVoiceAgent(args: {
  userText: string;
  deviceContext: DeviceContext;
  history: AgentTurn[];
  /// 応答言語。 省略時は voicePref から取る。
  language?: VoiceLanguage;
}): Promise<AgentResponse> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('EXPO_PUBLIC_ANTHROPIC_API_KEY is required for voice agent');
  }
  const lang = args.language ?? getVoiceLanguage();

  // 履歴を最新 MAX_HISTORY_TURNS ペアに truncate (= context 肥大防止)。
  const trimmedHistory = args.history.slice(-MAX_HISTORY_TURNS * 2);

  const userMessage = [
    `DeviceContext:`,
    JSON.stringify(args.deviceContext, null, 2),
    '',
    lang === 'en' ? `User said:` : `ユーザ発話:`,
    args.userText,
  ].join('\n');

  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(lang),
    messages: [
      ...trimmedHistory.map((t) => ({ role: t.role, content: t.text })),
      { role: 'user', content: userMessage },
    ],
  };

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Claude API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    content?: Array<{ type: string; text: string }>;
  };
  const rawText = json.content?.find((c) => c.type === 'text')?.text ?? '';

  return parseAgentResponse(rawText);
}

function parseAgentResponse(rawText: string): AgentResponse {
  // JSON 部分を抽出 (= prose 混じりで来た場合に備える)。 最初の { から最後の } まで。
  const m = rawText.match(/\{[\s\S]*\}/);
  const cleaned = m ? m[0] : rawText;

  let parsed: { response_text?: unknown; action?: unknown };
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Claude response is not JSON: ${(e as Error).message}. raw=${rawText.slice(0, 200)}`);
  }

  const responseText = typeof parsed.response_text === 'string' ? parsed.response_text : '';
  const action = parsed.action as AgentAction | undefined;
  if (!action || typeof action.type !== 'string') {
    throw new Error(`Claude response missing valid action: raw=${rawText.slice(0, 200)}`);
  }

  return {
    response_text: responseText,
    action,
  };
}

// ─── TTS ────────────────────────────────────────────────────────────────

/// 応答 text を読み上げる。 既に再生中なら中断して新しいものを差し替え。
/// 言語自動判定: ASCII + 通常記号だけなら en-US、 それ以外 (= 日本語混入) は ja-JP。
/// 明示的に上書きしたい時は language を指定する。
export function speak(text: string, language?: 'ja-JP' | 'en-US' | string): void {
  if (!text) return;
  Speech.stop();
  const lang = language ?? (looksEnglish(text) ? 'en-US' : 'ja-JP');
  Speech.speak(text, {
    language: lang,
    // en は少し速め、 ja は標準。 AVSpeechSynthesizer の rate は OS で正規化される。
    rate: lang.startsWith('en') ? 1.0 : 1.05,
    pitch: 1.0,
  });
}

/// ASCII + 一般句読点だけで構成されているか (= 日本語が混じってないか) のラフ判定。
function looksEnglish(text: string): boolean {
  // 半角英数 + 標準句読点 + 空白 + アポストロフィ + ハイフン等のみで構成されているなら english
  return /^[\x20-\x7E]+$/.test(text);
}

export function stopSpeaking(): void {
  Speech.stop();
}

/// 単一タスクに対応する TaskDef を返す (= action.task_id が来た時の確認用)。
export function findActionTask(taskId: string | undefined): TaskDef | null {
  if (!taskId) return null;
  return TASKS.find((t) => t.id === taskId) ?? null;
}
