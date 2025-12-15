import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { mediaProofId, walletAddress, title, description, price } = await req.json();

    if (!mediaProofId || !walletAddress) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 1. 所有権の確認
    // 指定されたmediaProofIdのレコードを取得し、owner_walletが一致するか確認
    // ※ 厳密にはSolana上の所有権を確認すべきですが、DB上のowner_walletを信頼する形とします
    interface MediaProof {
      owner_wallet: string;
    }

    const { data: proof, error: fetchError } = await supabase
      .from('media_proofs')
      .select('owner_wallet')
      .eq('id', mediaProofId)
      .single();

    if (fetchError || !proof) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    if (proof.owner_wallet !== walletAddress) {
      return NextResponse.json({ error: 'Unauthorized: You are not the owner' }, { status: 403 });
    }

    // 2. データの更新
    // priceはlamports単位で保存されていると仮定（upload時の実装に基づく）
    interface MediaProofUpdate {
      title?: string;
      description?: string;
      price_lamports?: number;
    }
    const updates: Partial<MediaProofUpdate> = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (price !== undefined) updates.price_lamports = price;

    const { error: updateError } = await supabase
      .from('media_proofs')
      .update(updates)
      .eq('id', mediaProofId);

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Update content error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
