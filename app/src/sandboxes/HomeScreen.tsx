import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { sandboxes, type SandboxEntry } from './registry';
import type { SandboxStackParamList } from '../../App';

// Top-level launcher for v0.1.2 sandboxes.
// Light theme + navy ink to match the rest of the app. Editorial list style with hairline dividers.

type Nav = NativeStackNavigationProp<SandboxStackParamList>;

const COLORS = {
  bgWarm: '#fafaf7',
  bgWhite: '#ffffff',
  ink: '#0a1f44',
  inkSoft: '#13284e',
  textBody: '#1a2940',
  textMute: '#5a6b7c',
  textFaint: '#8a96a3',
  border: '#e5e1d8',
};

const FONTS = {
  displayLight: 'Fraunces_300Light',
  displayRegular: 'Fraunces_400Regular',
  displayMedium: 'Fraunces_500Medium',
  mono: 'Menlo',
};

export default function HomeScreen() {
  const nav = useNavigation<Nav>();
  return (
    <View style={styles.root}>
      <FlatList
        data={sandboxes}
        keyExtractor={(s) => s.id}
        ListHeaderComponent={<Header />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item, index }) => (
          <Row entry={item} index={index + 1} onPress={() => nav.navigate(item.id)} />
        )}
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const Header: React.FC = () => (
  <View style={styles.header}>
    <Text style={styles.brand}>RootLens</Text>
    <Text style={styles.eyebrow}>v0.1.2 · SANDBOX VERIFICATION</Text>
    <Text style={styles.lede}>
      Independently verifying each component of the Physical AI household-data collection pipeline before integration.
    </Text>
  </View>
);

const Row: React.FC<{ entry: SandboxEntry; index: number; onPress: () => void }> = ({
  entry, index, onPress,
}) => {
  // entry.id starts with "01-..." → use the leading number as ordinal display
  const m = entry.id.match(/^(\d+)/);
  const ordinal = m ? m[1] : String(index).padStart(2, '0');
  // Display title without leading "NN: " if present
  const cleanTitle = entry.title.replace(/^\d+\s*:\s*/, '');

  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} onPress={onPress}>
      <Text style={styles.rowOrdinal}>{ordinal}</Text>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{cleanTitle}</Text>
        <Text style={styles.rowDesc} numberOfLines={2}>{entry.description}</Text>
      </View>
      <Text style={styles.rowChevron}>→</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bgWarm },
  list: { paddingBottom: 64 },

  header: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 24,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  brand: {
    fontFamily: FONTS.displayLight,
    fontSize: 44,
    lineHeight: 50,
    letterSpacing: -1,
    color: COLORS.ink,
  },
  eyebrow: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: 1.6,
    color: COLORS.textMute,
    fontWeight: '600',
    marginTop: 2,
  },
  lede: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textMute,
    marginTop: 12,
    maxWidth: 480,
  },

  separator: {
    height: 1,
    backgroundColor: COLORS.border,
    marginHorizontal: 24,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 24,
    paddingVertical: 20,
    backgroundColor: COLORS.bgWarm,
  },
  rowPressed: { backgroundColor: COLORS.bgWhite },
  rowOrdinal: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    letterSpacing: 0.4,
    color: COLORS.textFaint,
    width: 28,
  },
  rowBody: { flex: 1, gap: 4 },
  rowTitle: {
    fontFamily: FONTS.displayMedium,
    fontSize: 18,
    color: COLORS.ink,
    letterSpacing: -0.2,
  },
  rowDesc: {
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.textMute,
  },
  rowChevron: {
    fontSize: 20,
    color: COLORS.ink,
    fontWeight: '300',
  },
});
