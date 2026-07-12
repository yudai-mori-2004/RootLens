// Structured events emitted by the dataflow layer.
//
// Each step reports its progress and outcome through an EventSink callback.
// Logging, store updates, and UI display are all the caller's responsibility;
// a step never touches state as a side effect. This keeps steps as pure
// input → output functions that plug equally into React, a CLI, or a test.
//
// ⚠ Dataflow layer: must not import react / react-native.

export type EventLevel = 'info' | 'success' | 'warn' | 'error';

export interface DataflowEvent {
  /** Unique id; doubles as the React key in log lists. */
  id: string;
  /** ms epoch */
  ts: number;
  /** Which step emitted it ('record' | 'content-hash' | 'r2-upload' | 'register-clip' | ...). */
  step: string;
  level: EventLevel;
  message: string;
  /** Optional structured detail (content hash, byte counts, ...). */
  detail?: unknown;
}

/** What callers pass to an EventSink (id / ts are stamped by the receiver). */
export type DataflowEventInput = Omit<DataflowEvent, 'id' | 'ts'>;

/** Callback a step uses to report progress. */
export type EventSink = (e: DataflowEventInput) => void;

let seq = 0;

/** Stamp an input event with id / ts to make a complete DataflowEvent. */
export function makeEvent(input: DataflowEventInput): DataflowEvent {
  seq += 1;
  return {
    ...input,
    id: `evt_${Date.now().toString(36)}_${seq.toString(36)}`,
    ts: Date.now(),
  };
}

/** Sink that drops every event (for callers that do not care about progress). */
export const noopSink: EventSink = () => {};

/**
 * Wraps a sink so events also mirror to the console, which makes them visible
 * in the Metro log during development.
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
