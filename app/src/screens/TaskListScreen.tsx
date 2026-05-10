import React from 'react';
import { FlatList, Image, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../app/types';
import { TASKS, type TaskDef } from '../domain/taskCatalog';
import { colors, typography, spacing, radii } from '../theme';

// SPECS_JA §2.2 / 2.3 step 1: 運営が事前定義した有限タスクから 1 件選ばせる。
// 各タスクは start/end condition を持ち、後続の VLM gate に渡る。

type Props = NativeStackScreenProps<RootStackParamList, 'TaskList'>;

export const TaskListScreen: React.FC<Props> = ({ navigation }) => {
  return (
    <SafeAreaView style={styles.root}>
      <FlatList
        data={TASKS}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <Text style={styles.intro}>
            Pick a household chore to record. Both hands must remain in frame throughout.
          </Text>
        }
        renderItem={({ item }) => (
          <TaskRow task={item} onPress={() => navigation.navigate('Capture', { taskId: item.id })} />
        )}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
      />
    </SafeAreaView>
  );
};

const TaskRow: React.FC<{ task: TaskDef; onPress: () => void }> = ({ task, onPress }) => (
  <Pressable
    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    onPress={onPress}
  >
    <View style={styles.rowMain}>
      <Text style={styles.emoji}>{task.emoji}</Text>
      <View style={styles.rowText}>
        <Text style={styles.name}>{task.name}</Text>
        <Text style={styles.condition} numberOfLines={2}>
          End: {task.endCondition}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </View>
    {task.startIllustration ? (
      <View style={styles.illoRow}>
        <ConditionThumb label="START" image={task.startIllustration} />
        <ConditionThumb label="END" image={task.endIllustration} />
      </View>
    ) : null}
  </Pressable>
);

const ConditionThumb: React.FC<{ label: string; image?: any }> = ({ label, image }) => (
  <View style={styles.thumbBlock}>
    <Text style={styles.thumbLabel}>{label}</Text>
    {image ? (
      <Image source={image} style={styles.thumb} resizeMode="cover" />
    ) : (
      <View style={[styles.thumb, styles.thumbMissing]} />
    )}
  </View>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  list: { paddingBottom: spacing.xxl },
  intro: {
    ...typography.body,
    color: colors.textSecondary,
    padding: spacing.lg,
  },
  sep: { height: 1, backgroundColor: colors.borderLight, marginHorizontal: spacing.lg },

  row: { padding: spacing.lg, gap: spacing.md },
  rowPressed: { backgroundColor: colors.surface },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  emoji: { fontSize: 28, width: 36, textAlign: 'center' },
  rowText: { flex: 1, gap: 2 },
  name: { ...typography.title, color: colors.textPrimary },
  condition: { ...typography.caption, color: colors.textSecondary },
  chevron: { fontSize: 24, color: colors.textHint, paddingLeft: spacing.sm },

  illoRow: { flexDirection: 'row', gap: spacing.sm },
  thumbBlock: { flex: 1, gap: 4 },
  thumbLabel: {
    ...typography.label,
    color: colors.textHint,
    letterSpacing: 1.2,
  },
  thumb: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.sm,
  },
  thumbMissing: {},
});
