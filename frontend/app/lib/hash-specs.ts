// RootLens Device Hash Specifications
//
// このファイルは、各デバイス（カメラ、編集ソフト）が生成するC2PAマニフェストにおいて、
// どのアサーションを「コンテンツ固有のID (originalHash)」として採用するかを定義する仕様書です。
//
// RootLensは、この定義に基づいて決定論的（Deterministic）にハッシュを抽出します。
// これにより、アサーションの順序入れ替えなどの影響を受けず、常に一意のIDが生成されます。

export interface DeviceHashSpec {
  id: string;
  vendor: string;
  matcher: string | RegExp; // claimGenerator (User Agent) に含まれる文字列または正規表現
  targetLabel: string;      // 採用するアサーションのラベル (完全一致)
  description: string;
}

export const DEVICE_HASH_SPECS: DeviceHashSpec[] = [
  {
    id: 'google-pixel',
    vendor: 'Google',
    matcher: /Google|Pixel/i,
    targetLabel: 'c2pa.hash.data.part',
    description: 'PixelシリーズなどのGoogleデバイスは、部分ハッシュ(c2pa.hash.data.part)を主要な識別子として使用します。',
  },
  {
    id: 'sony-camera',
    vendor: 'Sony',
    matcher: /Sony/i,
    targetLabel: 'c2pa.hash.data',
    description: 'Sony製カメラは、C2PA標準のデータハッシュ(c2pa.hash.data)を使用します。',
  },
  {
    id: 'leica-camera',
    vendor: 'Leica',
    matcher: /Leica/i,
    targetLabel: 'c2pa.hash.data',
    description: 'Leica製カメラは、C2PA標準のデータハッシュ(c2pa.hash.data)を使用します。',
  },
  {
    id: 'nikon-camera',
    vendor: 'Nikon',
    matcher: /Nikon/i,
    targetLabel: 'c2pa.hash.data',
    description: 'Nikon製カメラは、C2PA標準のデータハッシュ(c2pa.hash.data)を使用します。',
  },
  {
    id: 'canon-camera',
    vendor: 'Canon',
    matcher: /Canon/i,
    targetLabel: 'c2pa.hash.data',
    description: 'Canon製カメラは、C2PA標準のデータハッシュ(c2pa.hash.data)を使用します。',
  },
  {
    id: 'adobe-software',
    vendor: 'Adobe',
    matcher: /Adobe/i,
    targetLabel: 'c2pa.hash.data',
    description: 'Adobe Photoshop / Lightroomなどの編集ソフトは、標準のデータハッシュを使用します。',
  },
  {
    id: 'truepic',
    vendor: 'Truepic',
    matcher: /Truepic/i,
    targetLabel: 'c2pa.hash.data',
    description: 'Truepic署名済みコンテンツは、標準のデータハッシュを使用します。',
  }
];

// ルールにマッチしなかった場合は非対応（エラー）となります。
