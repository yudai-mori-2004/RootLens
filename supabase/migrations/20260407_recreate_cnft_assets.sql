-- cnft_assets v2: ルックアップテーブルのみ。signed_jsonは保存しない。
drop table if exists cnft_assets;

create table cnft_assets (
  asset_id          text primary key,
  content_hash      text not null,
  processor_id      text not null,
  network           text not null default 'devnet',
  solana_block_time bigint not null,
  tsa_timestamp     bigint
);

create index idx_cnft_content_hash on cnft_assets(network, content_hash);

alter table cnft_assets enable row level security;
create policy "cnft_assets_read" on cnft_assets for select using (true);
