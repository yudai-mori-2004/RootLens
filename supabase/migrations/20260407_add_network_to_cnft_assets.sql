alter table cnft_assets add column network text not null default 'devnet';

-- content_hash検索は常にnetworkと組み合わせる
drop index if exists idx_cnft_content_hash;
create index idx_cnft_content_hash on cnft_assets(network, content_hash);
