import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera } from 'expo-camera';
import { TaskListView } from './components/TaskListView';
import { BriefView } from './components/BriefView';
import { CaptureView } from './components/CaptureView';
import { ResultView } from './components/ResultView';
import { MintView } from './components/MintView';
import { findTask } from './tasks';
import { colors, fonts, radius, space, type } from './theme';
import type { VlmResult } from '../02-vlm-task-gate/vlmClient';

const DEMO_WALLET_ADDRESS = process.env.EXPO_PUBLIC_DEMO_WALLET_ADDRESS ?? '';

// Sandbox 04: Collection Flow
//
// End-to-end demo: hand pose detection + VLM gate + recording, in a single flow.
//
// Modes:
//   task_list → brief → capture → result → (back to list or record again)

interface ResultPayload {
  videoUri: string | null;
  endSnapshotUri: string | null;
  durationMs: number;
  vlmEnd: VlmResult | null;
  vlmEndError: string | null;
}

type Mode =
  | { kind: 'task_list' }
  | { kind: 'brief'; taskId: string }
  | { kind: 'capture'; taskId: string }
  | ({ kind: 'result'; taskId: string } & ResultPayload)
  | ({ kind: 'mint'; taskId: string } & ResultPayload);

export default function CollectionFlowScreen() {
  const [mode, setMode] = useState<Mode>({ kind: 'task_list' });
  const [permission, setPermission] = useState<'pending' | 'granted' | 'denied'>('pending');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await Camera.requestCameraPermissionsAsync();
      if (cancelled) return;
      setPermission(result.granted ? 'granted' : 'denied');
    })();
    return () => { cancelled = true; };
  }, []);

  const handlePick = useCallback((taskId: string) => {
    setMode({ kind: 'brief', taskId });
  }, []);

  const handleStart = useCallback(() => {
    if (mode.kind !== 'brief') return;
    setMode({ kind: 'capture', taskId: mode.taskId });
  }, [mode]);

  const handleCaptureComplete = useCallback(
    (r: {
      videoUri: string | null;
      endSnapshotUri: string | null;
      durationMs: number;
      vlmEnd: VlmResult | null;
      vlmEndError: string | null;
    }) => {
      setMode((prev) =>
        prev.kind === 'capture'
          ? { kind: 'result', taskId: prev.taskId, ...r }
          : prev,
      );
    },
    [],
  );

  const handleRedo = useCallback(() => {
    if (mode.kind !== 'result') return;
    setMode({ kind: 'capture', taskId: mode.taskId });
  }, [mode]);

  const handleBackToList = useCallback(() => {
    setMode({ kind: 'task_list' });
  }, []);

  const handleGoToMint = useCallback(() => {
    if (mode.kind !== 'result') return;
    const { taskId, videoUri, endSnapshotUri, durationMs, vlmEnd, vlmEndError } = mode;
    setMode({ kind: 'mint', taskId, videoUri, endSnapshotUri, durationMs, vlmEnd, vlmEndError });
  }, [mode]);

  const handleBackToResult = useCallback(() => {
    if (mode.kind !== 'mint') return;
    const { taskId, videoUri, endSnapshotUri, durationMs, vlmEnd, vlmEndError } = mode;
    setMode({ kind: 'result', taskId, videoUri, endSnapshotUri, durationMs, vlmEnd, vlmEndError });
  }, [mode]);

  if (permission === 'pending') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.bgInk} />
        <Text style={styles.centerEyebrow}>CAMERA PERMISSION</Text>
        <Text style={styles.centerBody}>Checking access…</Text>
      </View>
    );
  }
  if (permission === 'denied') {
    return (
      <View style={styles.center}>
        <Text style={styles.centerEyebrow}>PERMISSION REQUIRED</Text>
        <Text style={styles.centerHead}>Allow camera access</Text>
        <Text style={styles.centerBody}>
          Open the Settings app to grant RootLens access to the camera, then return here.
        </Text>
      </View>
    );
  }

  switch (mode.kind) {
    case 'task_list':
      return <TaskListView onPick={handlePick} />;
    case 'brief': {
      const task = findTask(mode.taskId);
      if (!task) return <UnknownTask onBack={handleBackToList} />;
      return <BriefView task={task} onStart={handleStart} onBack={handleBackToList} />;
    }
    case 'capture': {
      const task = findTask(mode.taskId);
      if (!task) return <UnknownTask onBack={handleBackToList} />;
      return (
        <CaptureView
          task={task}
          onComplete={handleCaptureComplete}
          onCancel={handleBackToList}
        />
      );
    }
    case 'result': {
      const task = findTask(mode.taskId);
      if (!task) return <UnknownTask onBack={handleBackToList} />;
      return (
        <ResultView
          task={task}
          videoUri={mode.videoUri}
          endSnapshotUri={mode.endSnapshotUri}
          durationMs={mode.durationMs}
          vlmEnd={mode.vlmEnd}
          vlmEndError={mode.vlmEndError}
          canMint={!!mode.videoUri && !!DEMO_WALLET_ADDRESS}
          onMint={handleGoToMint}
          onRedo={handleRedo}
          onBackToList={handleBackToList}
        />
      );
    }
    case 'mint': {
      const task = findTask(mode.taskId);
      if (!task) return <UnknownTask onBack={handleBackToList} />;
      return (
        <MintView
          task={task}
          videoUri={mode.videoUri}
          score={mode.vlmEnd?.score ?? null}
          onDone={handleBackToList}
          onCancel={handleBackToResult}
        />
      );
    }
  }
}

const UnknownTask: React.FC<{ onBack: () => void }> = ({ onBack }) => (
  <View style={styles.center}>
    <Text style={styles.centerEyebrow}>NOT FOUND</Text>
    <Text style={styles.centerHead}>Task not found</Text>
    <Pressable style={styles.button} onPress={onBack}>
      <Text style={styles.buttonText}>Back to tasks</Text>
    </Pressable>
  </View>
);

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    backgroundColor: colors.bgWarm,
    gap: space.m,
  },
  centerEyebrow: { ...type.caps, color: colors.textMute },
  centerHead: {
    fontFamily: fonts.displayRegular,
    fontSize: 24,
    letterSpacing: -0.3,
    color: colors.textInk,
  },
  centerBody: {
    ...type.body,
    color: colors.textMute,
    textAlign: 'center',
    maxWidth: 320,
  },
  button: {
    marginTop: space.m,
    paddingVertical: space.m,
    paddingHorizontal: space.xxl,
    borderRadius: radius.s,
    backgroundColor: colors.bgInk,
  },
  buttonText: {
    color: colors.textOnInk,
    fontFamily: fonts.displayMedium,
    fontSize: 14,
    letterSpacing: 0.2,
  },
});
