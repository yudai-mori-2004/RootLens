// React Native polyfills。 他のどの module よりも先に import すること (= index.ts 先頭)。
//
//   - crypto.getRandomValues (= 鍵生成 / uuid)
//   - Buffer (= native module (wideCapture) のバイナリ受け渡し)

import 'react-native-get-random-values';
import { Buffer } from 'buffer';

global.Buffer = global.Buffer || Buffer;
