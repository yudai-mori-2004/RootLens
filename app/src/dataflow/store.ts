// State store for the dataflow layer (Zustand vanilla).
//
// The single source of truth for the clip collection, the recording lifecycle,
// and the event log. Being a vanilla store it has no React dependency, so
// steps and orchestrators outside React can read and write it too. The UI
// subscribes through hooks (src/clips/hooks.ts) via useStore(dataflowStore, selector).
//
// ⚠ Dataflow layer: must not import react / react-native (zustand/vanilla is React-free).

import { createStore } from 'zustand/vanilla';

import { makeEvent, type DataflowEvent, type DataflowEventInput, type EventSink } from './events';
import type { Clip } from './types';
import type { RecordingSession } from './recording-configs';

/** Recording lifecycle. */
export type RecordingPhase =
  | 'idle'            // no session yet
  | 'session-active'  // preview running, not recording
  | 'recording'       // recording
  | 'recorded';       // stopped, not yet handed to the upload pipeline

const MAX_EVENTS = 500;

let localIdSeq = 0;
/** Device-issued local clip id (renamed to the content hash via renameClipId once hashing completes). */
export function makeLocalClipId(): string {
  localIdSeq += 1;
  return `local_${Date.now().toString(36)}_${localIdSeq.toString(36)}`;
}

export interface DataflowState {
  // ─── Recording session lifecycle (one at a time) ────────────────────
  recording: RecordingPhase;
  configId: string | null;
  session: RecordingSession | null;

  // ─── Clip collection (many; the single source of truth) ─────────────
  clips: Record<string, Clip>;
  /** Id of the clip currently moving through recording → upload (what progress UIs watch). */
  currentClipId: string | null;

  /** Label of the action in flight (blocks double taps, drives spinners). null when idle. */
  busy: string | null;
  events: DataflowEvent[];

  // ─── Recording actions ───────────────────────────────────────────────
  setRecording(phase: RecordingPhase): void;
  setSession(session: RecordingSession | null): void;
  setConfigId(id: string | null): void;

  // ─── Clip collection actions ─────────────────────────────────────────
  upsertClip(clip: Clip): void;
  patchClip(id: string, patch: Partial<Clip>): void;
  removeClip(id: string): void;
  /** Re-key a clip from its local id to the content hash (identity is born when hashing completes). */
  renameClipId(localId: string, contentHash: string): void;
  /** Bulk hydrate from the persistence adapter (pours saved clips in at startup). */
  replaceClips(clips: Clip[]): void;
  /** Set which clip progress UIs should watch. */
  setCurrentClipId(id: string | null): void;

  // ─── events / busy ──────────────────────────────────────────────────
  appendEvent(e: DataflowEventInput): void;
  clearEvents(): void;
  setBusy(label: string | null): void;

  /** Stop tracking the in-flight clip only (for starting a new recording; the collection stays). */
  resetCurrent(): void;
  /** Full reset (the dev sandbox's "reset" button). */
  reset(): void;
}

const INITIAL: Pick<
  DataflowState,
  'recording' | 'configId' | 'session' | 'clips' | 'currentClipId' | 'busy' | 'events'
> = {
  recording: 'idle',
  configId: null,
  session: null,
  clips: {},
  currentClipId: null,
  busy: null,
  events: [],
};

export const dataflowStore = createStore<DataflowState>((set, get) => ({
  ...INITIAL,

  setRecording(phase) { set({ recording: phase }); },
  setSession(session) { set({ session }); },
  setConfigId(id) { set({ configId: id }); },

  upsertClip(clip) {
    set({ clips: { ...get().clips, [clip.id]: clip } });
  },
  patchClip(id, patch) {
    const cur = get().clips[id];
    if (!cur) return;
    set({ clips: { ...get().clips, [id]: { ...cur, ...patch } } });
  },
  removeClip(id) {
    const { [id]: _removed, ...rest } = get().clips;
    set({
      clips: rest,
      currentClipId: get().currentClipId === id ? null : get().currentClipId,
    });
  },
  renameClipId(localId, contentHash) {
    if (localId === contentHash) return;
    const clips = get().clips;
    const cur = clips[localId];
    if (!cur) return;
    const { [localId]: _old, ...rest } = clips;
    set({
      clips: { ...rest, [contentHash]: { ...cur, id: contentHash } },
      currentClipId: get().currentClipId === localId ? contentHash : get().currentClipId,
    });
  },
  replaceClips(clips) {
    const map: Record<string, Clip> = {};
    for (const c of clips) map[c.id] = c;
    set({ clips: map });
  },
  setCurrentClipId(id) { set({ currentClipId: id }); },

  appendEvent(input) {
    const event = makeEvent(input);
    const events = get().events.concat(event);
    set({ events: events.length > MAX_EVENTS ? events.slice(-MAX_EVENTS) : events });
  },
  clearEvents() { set({ events: [] }); },
  setBusy(label) { set({ busy: label }); },

  resetCurrent() { set({ currentClipId: null }); },
  reset() { set({ ...INITIAL, clips: {}, events: [] }); },
}));

// ─── Selectors (pure; UI hooks wrap them in useMemo) ───────────────────

/** Clip list, newest first. Callers should memoize with s.clips as the dependency. */
export function clipList(clips: Record<string, Clip>): Clip[] {
  return Object.values(clips).sort((a, b) => b.createdAt - a.createdAt);
}

/** Look up a clip by id (null when absent). */
export function selectClip(state: DataflowState, id: string | null | undefined): Clip | null {
  if (!id) return null;
  return state.clips[id] ?? null;
}

/** The in-flight clip (whatever currentClipId points at). */
export function selectCurrentClip(state: DataflowState): Clip | null {
  return state.currentClipId ? state.clips[state.currentClipId] ?? null : null;
}

/**
 * EventSink that appends into the store. Hand this to steps / orchestrators.
 * Wrap it with teeToConsole from events.ts to also mirror to the console.
 */
export const storeEventSink: EventSink = (e) => {
  dataflowStore.getState().appendEvent(e);
};
