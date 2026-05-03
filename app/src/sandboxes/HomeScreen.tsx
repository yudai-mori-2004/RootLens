import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { sandboxes } from './registry';
import type { SandboxStackParamList } from '../../App';

type Nav = NativeStackNavigationProp<SandboxStackParamList>;

export default function HomeScreen() {
  const nav = useNavigation<Nav>();

  return (
    <View style={styles.container}>
      <FlatList
        data={sandboxes}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => nav.navigate(item.id)}
          >
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.desc}>{item.description}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  list: { padding: 16 },
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  title: { color: '#fff', fontSize: 16, fontWeight: '600' },
  desc: { color: '#888', fontSize: 13, marginTop: 4 },
});
