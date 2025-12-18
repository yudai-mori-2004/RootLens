// RootLens Device Hash Specifications
//
// このファイルは、各デバイス（カメラ、編集ソフト）が生成するC2PAマニフェストにおいて、
// どのアサーションを「コンテンツ固有のID (originalHash)」として採用するかを定義する仕様書です。
//
// RootLensは、この定義に基づいて決定論的（Deterministic）にハッシュを抽出します。
//
// マッチング基準:
// 以前は `claimGenerator` (ツール名) を使用していましたが、
// より信頼性の高い `signatureInfo.issuer` (署名発行者) を基準に変更しました。

export interface DeviceHashSpec {
  id: string;
  vendor: string;
  matcher: string | RegExp; // signatureInfo.issuer に含まれる文字列または正規表現
  targetLabels: string[];      // 採用するアサーションのラベル (完全一致)
  description: string;
  isTrustedIssuer: boolean; // このIssuerがRootLensにとって信頼できるかどうか
}

export const DEVICE_HASH_SPECS: DeviceHashSpec[] = [
  // Google (Pixel)
  {
    id: 'google-pixel',
    vendor: 'Google',
    matcher: 'Google LLC',
    // ★変更: 配列にして、両方のパターンを登録します
    // 優先順位をつけたい場合、配列の先頭を優先するロジックにすることも可能です
    targetLabels: [
      'c2pa.hash.data.part', // 通常の写真
      'c2pa.hash.data'       // 動画スナップショット
    ],
    description: 'Googleデバイス(Pixel等)の署名。通常写真は.part、スナップショットは標準ハッシュを使用します。',
    isTrustedIssuer: true,
  },
  
  // 以下は動作確認が取れ次第、順次有効化します。
  // 現時点では正確なIssuer名とハッシュ構造が未確認のため、安全のため無効化しています。
  /*
  {
    id: 'sony-camera',
    vendor: 'Sony',
    matcher: /Sony/i,
    targetLabel: 'c2pa.hash.data',
    description: 'Sony製カメラは、C2PA標準のデータハッシュ(c2pa.hash.data)を使用します。',
    isTrustedIssuer: true,
  },
  {
    id: 'leica-camera',
    vendor: 'Leica',
    matcher: /Leica/i,
    targetLabel: 'c2pa.hash.data',
    description: 'Leica製カメラは、C2PA標準のデータハッシュ(c2pa.hash.data)を使用します。',
    isTrustedIssuer: true,
  },
  {
    id: 'nikon-camera',
    vendor: 'Nikon',
    matcher: /Nikon/i,
    targetLabel: 'c2pa.hash.data',
    description: 'Nikon製カメラは、C2PA標準のデータハッシュ(c2pa.hash.data)を使用します。',
    isTrustedIssuer: true,
  },
  {
    id: 'canon-camera',
    vendor: 'Canon',
    matcher: /Canon/i,
    targetLabel: 'c2pa.hash.data',
    description: 'Canon製カメラは、C2PA標準のデータハッシュ(c2pa.hash.data)を使用します。',
    isTrustedIssuer: true,
  },
  {
    id: 'adobe-software',
    vendor: 'Adobe',
    matcher: /Adobe/i,
    targetLabel: 'c2pa.hash.data',
    description: 'Adobe Photoshop / Lightroomなどの編集ソフトは、標準のデータハッシュを使用します。',
    isTrustedIssuer: true,
  },
  {
    id: 'truepic',
    vendor: 'Truepic',
    matcher: /Truepic/i,
    targetLabel: 'c2pa.hash.data',
    description: 'Truepic署名済みコンテンツは、標準のデータハッシュを使用します。',
    isTrustedIssuer: true,
  },
  {
    id: 'openai', // AI生成はTrustedIssuerではないが、判定は可能
    vendor: 'OpenAI',
    matcher: /OpenAI/i,
    targetLabel: 'c2pa.hash.data', // AI生成物の場合、このハッシュを使うかは要検討
    description: 'OpenAIによるAI生成コンテンツ。',
    isTrustedIssuer: false, // AI生成物は信頼できない発行者として扱う
  }
  */
];

// 信頼できるIssuerのリストを生成するヘルパー関数
export function getTrustedIssuerNames(): string[] {
  const trustedIssuers: string[] = [];
  DEVICE_HASH_SPECS.forEach(spec => {
    if (spec.isTrustedIssuer && typeof spec.matcher === 'string') {
      trustedIssuers.push(spec.matcher);
    }
    // TODO: 正規表現 matcher の場合も考慮に入れるか
  });
  return trustedIssuers;
}
