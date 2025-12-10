import { Lock, Cloud, Link, BookOpen, AlertTriangle } from 'lucide-react';

export default function TechnicalDetailsSection() {
  return (
    <div className="space-y-6">
      {/* 永久保存データ */}
      <div className="space-y-3">
        <h4 className="flex items-center gap-2 font-bold text-gray-900 text-xs uppercase tracking-wider pl-1">
          <Lock className="w-4 h-4 text-gray-500" /> 永久に保存される情報（削除不可）
        </h4>
        <div className="bg-gray-50 p-4 rounded-lg text-xs space-y-2 border border-gray-200">
          <p><span className="font-semibold text-gray-700">保存先:</span> ブロックチェーン (Arweave / Solana)</p>
          <p className="leading-relaxed">
            コンテンツのハッシュ値、ルート署名者、証明書チェーン、cNFTのアドレスが永久に記録されます。
            <br />
            <span className="text-gray-500 block mt-1">※これらのデータから元の画像内容や詳細な個人情報を特定することは数学的に不可能です。</span>
          </p>
        </div>
      </div>

      {/* サーバー保存データ */}
      <div className="space-y-3">
        <h4 className="flex items-center gap-2 font-bold text-gray-900 text-xs uppercase tracking-wider pl-1">
          <Cloud className="w-4 h-4 text-gray-500" /> RootLensサーバーに保存される情報
        </h4>
        <div className="bg-indigo-50 p-4 rounded-lg text-xs space-y-4 border border-indigo-200 text-indigo-900">
          <div>
            <p className="font-semibold mb-2 text-indigo-800">保存先: RootLensデータベース / クラウドストレージ</p>
            <p className="font-bold text-xs mb-2 text-indigo-800">公開・保存されるデータ:</p>
            <ul className="space-y-3 ml-1">
              <li className="flex gap-2 items-start">
                <span className="bg-indigo-200 w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" />
                <div>
                  <strong className="text-indigo-900">元のコンテンツファイル</strong> (写真・動画ファイル本体)
                  <p className="text-indigo-700/80 mt-0.5 ml-1">
                    これにはExif情報（GPS位置情報、撮影日時、カメラシリアル番号など）が
                    <strong className="text-red-600 bg-red-50 px-1 rounded mx-1">そのまま含まれます</strong>。
                  </p>
                </div>
              </li>
              <li className="flex gap-2 items-start">
                <span className="bg-indigo-200 w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" />
                <div>
                  <strong className="text-indigo-900">C2PAメタデータ</strong> (JSON形式)
                  <ul className="mt-1 ml-1 space-y-1 text-indigo-800/80 border-l-2 border-indigo-200 pl-3">
                    <li>Root署名者情報（必須）</li>
                    <li>サムネイル画像（C2PAに埋め込まれていれば）</li>
                    <li>GPS位置情報、撮影日時、カメラ情報などの詳細メタデータ（C2PAに埋め込まれていれば）</li>
                    <li>編集・フィルタリングなどの履歴情報</li>
                  </ul>
                </div>
              </li>
            </ul>
          </div>
          
          <div className="bg-white p-3 rounded-md border border-indigo-100 shadow-sm">
            <p className="font-bold text-indigo-700 mb-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> プライバシーに関する注意
            </p>
            <p className="leading-relaxed">
              RootLensはコンテンツファイルからExif情報などを<strong>フィルタリングしません</strong>。
              位置情報などを公開したくない場合は、アップロード前にご自身で削除してください。
            </p>
          </div>

          <p className="text-indigo-700 font-medium border-t border-indigo-200/50 pt-3 mt-2 text-center">
            ※これらの情報はあなたの操作でいつでも削除可能です（削除後は閲覧できなくなります）。
          </p>
        </div>
      </div>

      {/* 証明メカニズム */}
      <div className="space-y-3">
        <h4 className="flex items-center gap-2 font-bold text-gray-900 text-xs uppercase tracking-wider pl-1">
          <Link className="w-4 h-4 text-gray-500" /> 真正性と所有権の証明メカニズム
        </h4>
        <div className="p-1 text-xs space-y-3 leading-relaxed text-gray-600">
          <p>
            <strong className="text-gray-800">相互リンクによる証明:</strong><br />
            Arweave上の記録（ハッシュ等）とSolana上のcNFT（所有権）が相互にリンクすることで、改ざん不可能な証明を形成します。
            これにより、後から不正なNFTを紐付ける「乗っ取り」を防ぎます。
          </p>
          <p>
            <strong className="text-gray-800">オリジナルの定義:</strong><br />
            ある画像ハッシュを持つArweaveデータの中で、有効なcNFTへのリンクを持つ<strong>「最古の記録」</strong>をオリジナルとみなします。
          </p>
          <p>
            <strong className="text-gray-800">所有権とBurn:</strong><br />
            相互リンクされたcNFTを保有するウォレットが、正当な所有者です。
            もしcNFTがBurn（焼却）されていれば、そのコンテンツの所有者は存在しない（所有権放棄済み）こととなります。
          </p>
        </div>
      </div>

      {/* 用語解説 */}
      <div className="space-y-3 pt-4 border-t border-gray-100">
        <h4 className="flex items-center gap-2 font-bold text-gray-900 text-xs uppercase tracking-wider pl-1">
          <BookOpen className="w-4 h-4 text-gray-500" />
          用語解説
        </h4>
        <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
          <dl className="space-y-5">
            <div>
              <dt className="text-sm font-bold text-slate-800 mb-1 flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full" /> ハッシュ値
              </dt>
              <dd className="text-xs text-slate-600 leading-relaxed pl-3.5 border-l border-slate-200 ml-0.5">
                デジタルデータの「指紋」のようなもの。画像が1ピクセルでも変わると全く異なる値になるため、改ざんされていないことの証明に使われます。
              </dd>
            </div>
            <div>
              <dt className="text-sm font-bold text-slate-800 mb-1 flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full" /> ルート署名者
              </dt>
              <dd className="text-xs text-slate-600 leading-relaxed pl-3.5 border-l border-slate-200 ml-0.5">
                SonyやCanonなどのカメラメーカーやAdobeなどの信頼できる組織。この署名があることで、データが正当な機器・ソフトで作成されたことが保証されます。
              </dd>
            </div>
            <div>
              <dt className="text-sm font-bold text-slate-800 mb-1 flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full" /> Arweave（アーウィーブ）
              </dt>
              <dd className="text-xs text-slate-600 leading-relaxed pl-3.5 border-l border-slate-200 ml-0.5">
                一度書き込むと二度と削除・変更ができない、半永久的なデータ保存ネットワーク。「デジタルの石板」のような役割を果たします。
              </dd>
            </div>
            <div>
              <dt className="text-sm font-bold text-slate-800 mb-1 flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full" /> cNFT（圧縮NFT）
              </dt>
              <dd className="text-xs text-slate-600 leading-relaxed pl-3.5 border-l border-slate-200 ml-0.5">
                Solanaブロックチェーン上で発行されるデジタル証明書。これが「この画像の所有権」を表します。
              </dd>
            </div>
            <div>
              <dt className="text-sm font-bold text-slate-800 mb-1 flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full" /> Burn（焼却）
              </dt>
              <dd className="text-xs text-slate-600 leading-relaxed pl-3.5 border-l border-slate-200 ml-0.5">
                NFTを二度と使えない状態にすること。これにより「所有権を放棄した（＝この世に所有者はいない）」ことを証明できます。
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}