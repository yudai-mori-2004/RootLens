import { createClient } from '@supabase/supabase-js';

export interface Env {
	R2_PRIVATE: R2Bucket;
	AI: Ai; // Add AI binding
	SUPABASE_URL: string;
	SUPABASE_SERVICE_KEY: string; // Renamed to match .dev.vars
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
		};

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		const url = new URL(request.url);

		try {
			if (url.pathname === '/process' && request.method === 'POST') {
				return await handleProcess(request, env, corsHeaders);
			}
			if (url.pathname === '/search' && request.method === 'POST') {
				return await handleSearch(request, env, corsHeaders);
			}

			return new Response('Not Found', { status: 404, headers: corsHeaders });
		} catch (error: any) {
			console.error('Worker Error:', error);
			return new Response(JSON.stringify({ error: error.message }), {
				status: 500,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}
	},
};

// -----------------------------------------------------------------------------
// 1. Process Handler (Triggered after R2 upload)
// -----------------------------------------------------------------------------
async function handleProcess(request: Request, env: Env, corsHeaders: Record<string, string>) {
	const formData = await request.formData();
    const imageFile = formData.get('image') as File;
    const originalHash = formData.get('originalHash') as string;
    const fileExtension = formData.get('fileExtension') as string;

	if (!imageFile || !originalHash || !fileExtension) {
		return new Response(JSON.stringify({ error: 'Missing file or metadata' }), {
			status: 400,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		});
	}

	const imageBuffer = await imageFile.arrayBuffer();

	// 2. Get Embedding using Workers AI (Captioning + Text Embedding)
	const result = await getEmbeddingFromImage(env, imageBuffer);

	if (!result) {
		throw new Error('Failed to generate embedding');
	}

	// 3. Save to Supabase
	const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

    let mediaId: string;

	// A. Insert into media_proofs (Initial Record)
	const { data: mediaData, error: mediaError } = await supabase
		.from('media_proofs')
		.insert({
			original_hash: originalHash,
			file_extension: fileExtension,
			// arweave_tx_id, cnft_mint_address, owner_wallet are NULL initially
		})
		.select('id')
		.single();

	if (mediaError) {
		// Handle duplicate upload gracefully
		if (mediaError.code === '23505') { // Unique violation
            console.log('Image already registered, fetching existing ID...');
            const { data: existingData } = await supabase
                .from('media_proofs')
                .select('id')
                .eq('original_hash', originalHash)
                .single();
            
            if (!existingData) {
                throw new Error(`Failed to fetch existing media proof for hash: ${originalHash}`);
            }
            mediaId = existingData.id;
		} else {
		    throw new Error(`Supabase media insert error: ${mediaError.message}`);
        }
	} else {
        mediaId = mediaData.id;
    }

	// B. Insert into feature_vectors
    // First check if vector already exists to avoid duplicate vector rows
    const { count } = await supabase
        .from('feature_vectors')
        .select('*', { count: 'exact', head: true })
        .eq('media_proof_id', mediaId);
    
    if (count === 0) {
        const { error: vectorError } = await supabase
            .from('feature_vectors')
            .insert({
                media_proof_id: mediaId,
                embedding: `[${result.embedding.join(',')}]`, // format for pgvector
                model_name: 'uform-gen2-qwen-500m + bge-base-en-v1.5',
            });

        if (vectorError) {
            console.error(`Supabase vector insert error: ${vectorError.message}`);
        }
    } else {
        console.log('Vector already exists, skipping insert.');
    }

	return new Response(JSON.stringify({ success: true, id: mediaId }), {
		status: 200,
		headers: { ...corsHeaders, 'Content-Type': 'application/json' },
	});
}

// -----------------------------------------------------------------------------
// 2. Search Handler
// -----------------------------------------------------------------------------
async function handleSearch(request: Request, env: Env, corsHeaders: Record<string, string>) {
	let queryEmbedding: number[];
	let generatedCaption: string = '';

	// Determine if the request is for image search (FormData) or text search (JSON)
	const contentType = request.headers.get('content-type') || '';

	if (contentType.includes('multipart/form-data')) {
		// Image search
		const formData = await request.formData();
		const imageFile = formData.get('image') as File;

		if (!imageFile) {
			return new Response(JSON.stringify({ error: 'No image provided for search' }), {
				status: 400,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}

		const imageBuffer = await imageFile.arrayBuffer();
		const result = await getEmbeddingFromImage(env, imageBuffer);

		if (!result) {
			throw new Error('Failed to generate query embedding from image');
		}
		queryEmbedding = result.embedding;
		generatedCaption = result.caption;

	} else if (contentType.includes('application/json')) {
		// Text search
		const { query_text } = await request.json() as { query_text: string };

		if (!query_text) {
			return new Response(JSON.stringify({ error: 'No query text provided for search' }), {
				status: 400,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}

		const embedding = await getEmbeddingFromText(env, query_text);
		if (!embedding) {
			throw new Error('Failed to generate query embedding from text');
		}
		queryEmbedding = embedding;
		generatedCaption = query_text; // For text search, caption is the query text itself

	} else {
		return new Response(JSON.stringify({ error: 'Unsupported content type for search' }), {
			status: 415,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		});
	}

	console.log(`Generated Caption: "${generatedCaption}"`);

	// Call RPC for similarity search
	const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
	
	const { data: results, error } = await supabase.rpc('search_similar_images', {
		query_embedding: `[${queryEmbedding.join(',')}]`, // pgvector format
		match_count: 20,
	});

	if (error) {
		throw new Error(`Supabase search error: ${error.message}`);
	}

	return new Response(JSON.stringify({ results, generated_caption: generatedCaption }), {
		status: 200,
		headers: { ...corsHeaders, 'Content-Type': 'application/json' },
	});
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function uploadToR2(env: Env, hash: string, ext: string, buffer: ArrayBuffer): Promise<string> {
	const key = `media/${hash}/original.${ext}`;
	await env.R2_PRIVATE.put(key, buffer);
	return key;
}

// Use Workers AI for embedding from Image (Captioning + Text Embedding)
async function getEmbeddingFromImage(env: Env, imageBuffer: ArrayBuffer): Promise<{ embedding: number[], caption: string } | null> {
    try {
        // Step A: Generate caption from image using Workers AI
        const captionResult = await env.AI.run('@cf/unum/uform-gen2-qwen-500m', {
            image: [...new Uint8Array(imageBuffer)],
            prompt: 'Q: Describe this image in detail. A:', 
        }) as any;
        
        const caption = captionResult.description || captionResult.response || '';
        if (!caption) {
            throw new Error('Failed to generate caption from image');
        }

        // Step B: Generate embedding from caption using Workers AI
        const embeddingResult = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
            text: [caption], // input is an array of strings
        }) as { data: number[][] };

        return { embedding: embeddingResult.data[0], caption }; // Returns 768 dimensions and caption

    } catch (error: any) {
        console.error('Workers AI image embedding failed:', error);
        throw new Error(`Workers AI image embedding failed: ${error.message}`);
    }
}

// Use Workers AI for embedding from Text
async function getEmbeddingFromText(env: Env, text: string): Promise<number[] | null> {
    try {
        const embeddingResult = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
            text: [text],
        }) as { data: number[][] };

        return embeddingResult.data[0]; // Returns 768 dimensions

    } catch (error: any) {
        console.error('Workers AI text embedding failed:', error);
        throw new Error(`Workers AI text embedding failed: ${error.message}`);
    }
}
