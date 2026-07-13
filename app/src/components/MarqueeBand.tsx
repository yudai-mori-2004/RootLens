// LP のマーキー帯 (= 画面下端を流れるブランドコピー)。
//
// 同じ 1 周ぶんのテキストを 2 つ横に並べ、 1 周ぶんの幅だけ translateX で流し続ける
// (= 2 つ目が 1 つ目の開始位置に来た瞬間にループが戻るのでシームレス)。
// 幅は onLayout で実測する。 装飾なので pointerEvents は殺してある。

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '../theme';

const COPY = 'REAL HUMAN WORK IS TRAINING DATA ✦ 現場ではたらく人の作業を、ロボットの教材に ✦ ';
const SPEED_PX_PER_SEC = 32;

export const MarqueeBand: React.FC = () => {
  const [runWidth, setRunWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (runWidth <= 0) return;
    x.setValue(0);
    const loop = Animated.loop(
      Animated.timing(x, {
        toValue: -runWidth,
        duration: (runWidth / SPEED_PX_PER_SEC) * 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [runWidth, x]);

  return (
    <View style={styles.band} pointerEvents="none">
      <Animated.View style={[styles.track, { transform: [{ translateX: x }] }]}>
        <Text
          style={styles.text}
          numberOfLines={1}
          onLayout={(e) => setRunWidth(e.nativeEvent.layout.width)}
        >
          {COPY}
        </Text>
        <Text style={styles.text} numberOfLines={1}>
          {COPY}
        </Text>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  band: {
    height: 26,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.paperDeep,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  track: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: {
    fontFamily: fonts.dot,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.lpYellow,
    opacity: 0.75,
  },
});
