import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { TASKS, type TaskDef } from '../tasks';
import { colors, fonts, hairline, radius, space, type } from '../theme';

interface Props {
  onPick: (taskId: string) => void;
}

export const TaskListView: React.FC<Props> = ({ onPick }) => (
  <View style={styles.root}>
    <FlatList
      data={TASKS}
      keyExtractor={(t) => t.id}
      ListHeaderComponent={<Header />}
      ItemSeparatorComponent={Separator}
      renderItem={({ item, index }) => (
        <Row task={item} index={index + 1} onPick={() => onPick(item.id)} />
      )}
      contentContainerStyle={styles.list}
    />
  </View>
);

const Header: React.FC = () => (
  <View style={styles.header}>
    <Text style={styles.title}>Teach us housework.</Text>
    <Text style={styles.sub}>
      We’re robots-in-training. Pick a task and show us how it’s done.
    </Text>
  </View>
);

const Separator: React.FC = () => <View style={styles.separator} />;

const Row: React.FC<{ task: TaskDef; index: number; onPick: () => void }> = ({ task, index, onPick }) => (
  <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} onPress={onPick}>
    <Text style={styles.rowIndex}>{String(index).padStart(2, '0')}</Text>
    <View style={styles.rowEmojiBox}>
      <Text style={styles.rowEmoji}>{task.emoji}</Text>
    </View>
    <View style={styles.rowBody}>
      <Text style={styles.rowTitle}>{task.name}</Text>
      <Text style={styles.rowSub} numberOfLines={2}>
        {task.startCondition}
      </Text>
    </View>
    <Text style={styles.rowChevron}>→</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgWarm },
  list: { paddingBottom: space.xxxl },

  header: {
    paddingHorizontal: space.xl,
    paddingTop: space.xxl,
    paddingBottom: space.xl,
    gap: space.m,
  },
  eyebrow: {
    ...type.caps,
    color: colors.textMute,
  },
  title: {
    ...type.display1,
    color: colors.textInk,
  },
  sub: {
    ...type.body,
    color: colors.textMute,
    maxWidth: 480,
  },

  separator: {
    ...hairline('top'),
    marginHorizontal: space.xl,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.l,
    paddingHorizontal: space.xl,
    paddingVertical: space.l,
    backgroundColor: colors.bgWarm,
  },
  rowPressed: {
    backgroundColor: colors.bgWhite,
  },
  rowIndex: {
    ...type.monoS,
    color: colors.textFaint,
    width: 22,
  },
  rowEmojiBox: {
    width: 48,
    height: 48,
    borderRadius: radius.s,
    backgroundColor: colors.bgWhite,
    alignItems: 'center',
    justifyContent: 'center',
    ...hairline('all'),
  },
  rowEmoji: {
    fontSize: 26,
  },
  rowBody: { flex: 1, gap: 4 },
  rowTitle: {
    fontFamily: fonts.displayMedium,
    fontSize: 18,
    color: colors.textInk,
    letterSpacing: -0.2,
  },
  rowSub: {
    ...type.bodyS,
    color: colors.textMute,
  },
  rowChevron: {
    fontSize: 20,
    color: colors.textInk,
    fontWeight: '300',
  },
});
