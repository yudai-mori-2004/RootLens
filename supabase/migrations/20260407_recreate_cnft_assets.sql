-- cnft_assets テーブルを再作成（タイムスタンプフィールド追加）
drop table if exists cnft_assets;

create table cnft_assets (
  asset_id          text primary key,
  content_hash      text not null,
  processor_id      text not null,
  signed_json       jsonb not null,
  network           text not null default 'devnet',
  tsa_timestamp     bigint,           -- signed_json.payload.tsa_timestamp（Core、TSAあり時のみ）
  solana_block_time bigint not null,   -- トランザクションのblock time（全cNFT共通）
  indexed_at        timestamptz default now()
);

create index idx_cnft_content_hash on cnft_assets(network, content_hash);

-- RLS: 読み取りは公開、書き込みはservice_roleのみ
alter table cnft_assets enable row level security;
create policy "cnft_assets_read" on cnft_assets for select using (true);
