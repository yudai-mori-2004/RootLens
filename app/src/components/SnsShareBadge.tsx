import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import QRCode from 'react-native-qrcode-skia';

// 仕様書 §7.3.1 ウォーターマークバッジ

const BADGE_BG = '#0f1a3c';
const BADGE_BORDER = 'rgba(255,255,255,0.15)';
const QR_CONTAINER = 32; // 白背景の外枠サイズ
const QR_RENDER = 26;    // QR 描画サイズ（コンテナより小さく、はみ出し防止）
const CHECK_SIZE = 24;
const CHECK_COLOR = '#22C55E'; // チェックマーク緑

export interface SnsShareBadgeProps {
  icon: 'qr' | 'check';
  qrValue?: string;
  username?: string;
}

export default function SnsShareBadge({ icon, qrValue, username }: SnsShareBadgeProps) {
  const displayName = username ? username.replace(/^@/, '') : 'username';
  const nameColor = username ? '#878d9e' : '#4b536d';

  return (
    <View style={styles.badge}>
      {icon === 'qr' ? (
        <View style={styles.qrContainer}>
          <QRCode
            value={qrValue || 'https://rootlens.io'}
            size={QR_RENDER}
            color={BADGE_BG}
            padding={1}
            shapeOptions={{ shape: 'rounded' }}
          />
        </View>
      ) : (
        <View style={styles.checkCircle}>
          <Text style={styles.checkMark}>✓</Text>
        </View>
      )}
      <View style={styles.textGroup}>
        <Text style={styles.realText}>Real</Text>
        <Text style={[styles.usernameText, { color: nameColor }]} numberOfLines={1}>
          {displayName}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BADGE_BG,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: BADGE_BORDER,
    paddingVertical: 7,
    paddingLeft: 7,
    paddingRight: 10,
    gap: 7,
  },
  qrContainer: {
    width: QR_CONTAINER,
    height: QR_CONTAINER,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  checkCircle: {
    width: CHECK_SIZE,
    height: CHECK_SIZE,
    borderRadius: CHECK_SIZE / 2,
    backgroundColor: CHECK_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    marginTop: -1,
  },
  textGroup: {
    justifyContent: 'center',
    gap: 1,
  },
  realText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  usernameText: {
    fontSize: 9,
    fontWeight: '400',
    maxWidth: 100,
  },
});
