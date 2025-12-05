/**
 * RootScan C2PA Signer Worker
 *
 * このWorkerは以下の処理を行います：
 * 1. R2からアップロードされたファイルを取得
 * 2. C2PA署名を付与（Ingredient参照）
 * 3. 署名済みファイルをR2に保存
 * 4. サイドカーファイルを抽出・保存
 */

interface SignRequest {
	upload_id: string;
	r2_key: string;
	original_hash: string;
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		// CORSヘッダー
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
		};

		// OPTIONSリクエスト（CORS preflight）
		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		// POSTリクエストのみ受け付ける
		if (request.method !== 'POST') {
			return new Response('Method not allowed', {
				status: 405,
				headers: corsHeaders
			});
		}

		try {
			// リクエストボディを解析
			const body = await request.json() as SignRequest;
			const { upload_id, r2_key, original_hash } = body;

			if (!upload_id || !r2_key || !original_hash) {
				return Response.json(
					{ error: 'Missing required fields' },
					{ status: 400, headers: corsHeaders }
				);
			}

			// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
			// Step 1: R2からファイルを取得
			// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

			const object = await env.ROOTSCAN_STORAGE.get(r2_key);

			if (!object) {
				return Response.json(
					{ error: 'File not found in R2' },
					{ status: 404, headers: corsHeaders }
				);
			}

			const fileData = await object.arrayBuffer();
			const fileSize = fileData.byteLength;

			console.log(`✅ File retrieved from R2: ${r2_key} (${fileSize} bytes)`);

			// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
			// Step 2: C2PA署名処理（TODO: 後で実装）
			// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

			// 現時点では、ファイルをそのまま返す（署名なし）
			// 次のステップでRust WASMモジュールを追加して署名処理を実装

			// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
			// Step 3: 署名済みファイルをR2に保存（TODO）
			// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

			// 現時点では保存をスキップ

			// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
			// Step 4: レスポンス
			// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

			return Response.json(
				{
					success: true,
					message: 'File retrieved successfully (signing not yet implemented)',
					file_size: fileSize,
					r2_key,
				},
				{ headers: corsHeaders }
			);

		} catch (error) {
			console.error('Error in C2PA signer:', error);
			return Response.json(
				{
					error: 'Internal server error',
					details: error instanceof Error ? error.message : 'Unknown error'
				},
				{ status: 500, headers: corsHeaders }
			);
		}
	},
} satisfies ExportedHandler<Env>;
