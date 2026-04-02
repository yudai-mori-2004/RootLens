import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radii } from '../theme';
import { t } from '../i18n';

// 仕様書 §3.7.1 SNSシェア編集画面 — テキスト欄

interface ShareTextBoxProps {
  text: string;
}

export default function ShareTextBox({ text }: ShareTextBoxProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.text} selectable numberOfLines={3}>
        {text}
      </Text>
      <TouchableOpacity
        style={styles.copyButton}
        onPress={handleCopy}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons
          name={copied ? 'checkmark' : 'copy-outline'}
          size={18}
          color={copied ? colors.success : colors.accent}
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    padding: spacing.md,
    gap: spacing.sm,
  },
  text: {
    flex: 1,
    ...typography.caption,
    color: colors.textSecondary,
  },
  copyButton: {
    padding: spacing.xs,
  },
});
