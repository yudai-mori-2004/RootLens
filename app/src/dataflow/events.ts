// dataflow 層の構造化イベント。
//
// 各 step は実行中の進捗・成否を EventSink callback で吐き出す。
// 「ログ出力」「ストア更新」「UI 表示」はすべて呼び出し側 (store / sandbox) の責務であり、
// step 自体は副作用として state を触らない。これにより step は純粋な input → output 関数に保たれ、
// React にも CLI にもテストにも同じ形で組み込める。
//
// ⚠ このファイルは Layer 1 (dataflow)。react / react-native を import してはならない。

export type EventLevel = 'info' | 'success' | 'warn' | 'error';

export interface DataflowEvent {
  /** ログ一覧の React key 兼デバッグ用一意 ID */
  id: string;
  /** ms epoch */
  ts: number;
  /** どの step が出したか (= 'record' | 'sign-d1' | 'blur' | 'r2-upload' | ...) */
  step: string;
  level: EventLevel;
  message: string;
  /** 任意の構造化詳細 (= contentHash / バイト数など) */
  detail?: unknown;
}

/** EventSink に渡す入力 (= id / ts は受け手が付与する) */
export type DataflowEventInput = Omit<DataflowEvent, 'id' | 'ts'>;

/** step が進捗を報告するための callback。 */
export type EventSink = (e: DataflowEventInput) => void;

let seq = 0;

/** 入力イベントに id / ts を付与して完全な DataflowEvent にする。 */
export function makeEvent(input: DataflowEventInput): DataflowEvent {
  seq += 1;
  return {
    ...input,
    id: `evt_${Date.now().toString(36)}_${seq.toString(36)}`,
    ts: Date.now(),
  };
}

/** event を捨てる sink (= 進捗を気にしない呼び出し用)。 */
export const noopSink: EventSink = () => {};

/**
 * sink を console にもミラーする wrapper。開発時に Metro ログでも追えるようにする。
 * sandbox からは store の sink をこれで包んで使う。
 */
export function teeToConsole(sink: EventSink, prefix = 'dataflow'): EventSink {
  return (e) => {
    const line = `[${prefix}:${e.step}] ${e.message}`;
    if (e.level === 'error') console.error(line, e.detail ?? '');
    else if (e.level === 'warn') console.warn(line, e.detail ?? '');
    else console.log(line, e.detail ?? '');
    sink(e);
  };
}
