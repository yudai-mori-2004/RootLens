-- cNFT インデクサ���テーブル
-- Task 26: DAS APIの制約を回避し、content_hashでO(1)検索可能にする
create table cnft_assets (
  asset_id       text primary key,
  content_hash   text not null,
  processor_id   text not null,
  signed_json    jsonb not null,
  indexed_at     timestamptz default now()
);

create index idx_cnft_content_hash on cnft_assets(content_hash);
