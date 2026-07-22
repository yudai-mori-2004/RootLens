"use client";

// 4 パネル共通の再生ヘッド。 RGB video が master で、 currentTime を rAF で発信する。
// 他パネル (depth video / 3D scene / numeric) はここを購読して、 再生位置に応じた表示に更新する。
//
// なぜ Context か: React state を通すと video の 30 fps 更新でツリー全体が再描画される。
// ここは購読者だけ再描画したいので、 useSyncExternalStore パターンで実装する。

import { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

/** 再生ヘッドの状態。 t は「クリップ先頭からの秒数」 で、 durationSec は summary.json 由来。 */
interface PlayheadState {
  t: number;
  playing: boolean;
  durationSec: number;
}

/** Context に流すのは値ではなく「購読口」。 状態変更で React ツリー全体が再描画されるのを避ける。 */
interface Store {
  get(): PlayheadState;
  subscribe(l: () => void): () => void;
  setTime(t: number): void;
  setPlaying(p: boolean): void;
  toggle(): void;
}

const Ctx = createContext<Store | null>(null);

interface Props {
  durationSec: number;
  children: ReactNode;
}

export function TimeProvider({ durationSec, children }: Props) {
  const stateRef = useRef<PlayheadState>({ t: 0, playing: false, durationSec });
  const listenersRef = useRef(new Set<() => void>());

  // durationSec の props 変更を反映 (別 slug に切替えたときの想定)。
  useEffect(() => {
    stateRef.current = { ...stateRef.current, durationSec };
    listenersRef.current.forEach((l) => l());
  }, [durationSec]);

  const store = useRef<Store>({
    get: () => stateRef.current,
    subscribe: (l) => {
      listenersRef.current.add(l);
      return () => { listenersRef.current.delete(l); };
    },
    setTime: (t) => {
      const clamped = Math.max(0, Math.min(stateRef.current.durationSec, t));
      if (stateRef.current.t === clamped) return;
      stateRef.current = { ...stateRef.current, t: clamped };
      listenersRef.current.forEach((l) => l());
    },
    setPlaying: (p) => {
      if (stateRef.current.playing === p) return;
      stateRef.current = { ...stateRef.current, playing: p };
      listenersRef.current.forEach((l) => l());
    },
    toggle: () => {
      stateRef.current = { ...stateRef.current, playing: !stateRef.current.playing };
      listenersRef.current.forEach((l) => l());
    },
  }).current;

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

/** 完全な状態を購読 (時刻更新のたびに再描画される。 数値パネル・タイムラインなど用)。 */
export function usePlayhead(): PlayheadState {
  const store = useContext(Ctx);
  if (!store) throw new Error("usePlayhead must be inside TimeProvider");
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** 再生位置は購読せず、 コマンドだけ欲しい呼び出し元 (ボタンなど) 用。 */
export function usePlayheadControls() {
  const store = useContext(Ctx);
  if (!store) throw new Error("usePlayheadControls must be inside TimeProvider");
  return {
    setTime: useCallback((t: number) => store.setTime(t), [store]),
    setPlaying: useCallback((p: boolean) => store.setPlaying(p), [store]),
    toggle: useCallback(() => store.toggle(), [store]),
  };
}

/** Playing (真偽) だけ購読したい (ボタンの Play/Pause 表示切替など)。 */
export function usePlaying(): boolean {
  const store = useContext(Ctx);
  if (!store) throw new Error("usePlaying must be inside TimeProvider");
  return useSyncExternalStore(
    store.subscribe,
    () => store.get().playing,
    () => store.get().playing,
  );
}
