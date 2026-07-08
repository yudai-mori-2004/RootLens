# RootLens Cleanup Audit — v0.1.4-onwards Dead Code Inventory

> **由来**: 2026-07-09 に Opus エージェントが本リポの全読解可能ファイルを走査して生成した監査レポート
> の生コピー。 削除対象の file:line、 影響範囲、 曖昧項目を全て列挙している。 タスク 12 の実装時は
> このファイルを削除対象の一次情報源として扱う。 変更が生じたら追記して残す (= 次に触る人が
> 同じ調査をやり直さないため)。

---

## 1. Executive summary

Root cause of the audit: v0.1.3 was built around C2PA + Title Protocol + Solana cNFT + License NFT + staking. v0.1.4 (currently checked in) already deleted most server-side and app-side plumbing for those subsystems, but the **audit reveals four ongoing debts**:

1. **The Solana/NFT/staking crates (`programs/`, `crates/`, `tests/license-nft/`, `tests/staking/`, `Anchor.toml`, `Cargo.toml`, `network.json`)** are still committed and intentionally kept "for v0.1.5 mint re-wiring" per task 07 §6, but the user's 2026-07-09 instruction ("TP and NFT are not used anymore") kills that plan. All of it can go.
2. **The public-website verify pipeline (`web/lib/verify/`, `web/lib/data.ts`, `web/lib/types.ts`, `web/lib/supabase.ts`, `web/lib/server/page-store.ts`, `web/lib/server/r2.ts`, `web/app/[addressOrUsername]/page.tsx`, `web/app/p/[shortId]/page.tsx`, `web/app/why-blockchain/page.tsx`, `web/app/legal-basis/page.tsx`, `web/app/delete-account/page.tsx`, `web/app/api/v1/delete-account/route.ts`, `web/components/ContentPage.tsx`, `web/components/CreatorPage.tsx`, `web/components/lp/*`)** were built for content-authenticity-page TP verification and reference the DAS API + Supabase `users/pages/contents/cnft_assets` tables. This is a large chunk that also drags in `@title-protocol/sdk`, `@solana/web3.js`, `@aws-sdk/client-kms`, `bs58`, `canonicalize`, `cbor-x`, `mp4box`, `@peculiar/x509`, `sharp` from the deps.
3. **Since the user also declared "C2PA is no longer a selling point", the C2PA D1 remote-signing subsystem (added in v0.1.4 task 09) is also dead:** `web/app/api/v1/c2pa-sign/`, `web/lib/c2pa-certs.ts`, `native/c2pa-bridge/`, `app/src/dataflow/steps/sign.ts`, `app/src/native/c2paBridge.ts`, `app/modules/c2pa-bridge/`, `app/dev-certs/`, plus the `signature_hash` primary key everywhere.
4. **`tools/mock-device/` (Rust) is written for the v0.1.3 flow with TP `/process` + `/extension/solana` + `POST /api/clips` (with `rootAssetId`, `signedJsonUri`). It's incompatible with the current server contract and unusable now.**

Rough delete numbers: **~130 files delete outright**, **~40 files edited in place**, **1 forward-only DB migration** (drop `wallet_pubkey`→`account_pubkey` rename + `network` column + `tos_consents` table, replace `signature_hash` with `sha256_content_hash`). Risk is **medium**: the deletes are cleanly scoped by subsystem, but the identity migration (`signature_hash` → sha256-of-file) touches every R2 key path and requires coordinated app + web + Modal rollout.

---

## 2. Delete outright

### C2PA + certificate infrastructure (kill entirely)

Rationale: user declared C2PA is not a selling point. Server-side remote signing was added in v0.1.4 task 09; kill it and drop the D1 step from the pipeline.

- `native/c2pa-bridge/` — entire crate. `pipeline1.rs` builds JUMBF + D1 manifest, `lib.rs` has the CallbackSigner FFI, examples/`remote_sign_smoke.rs` calls `pipeline1_sign_d1_remote`. All dead once D1 is dropped.
- `native/c2pa-bridge/fixtures/chain.pem`, `native/c2pa-bridge/fixtures/ee.key` — Title Protocol test Ed25519 chain.
- `native/c2pa-bridge/c2pa_bridge.h` — C header.
- `app/modules/c2pa-bridge/` — Expo Module wrapper (iOS Swift + Rust `.a` libs). `libc2pa_rs.a`, `libc2pa_rs_device.a`, `libc2pa_rs_sim.a` are ~18MB each.
- `app/android/app/src/main/java/io/rootlens/app/C2paBridgeModule.kt`, `app/android/app/src/main/jni/c2pa_jni.c`, `app/android/app/src/main/jniLibs/*/libc2pa_bridge.so`, `app/android/app/src/main/jniLibs/*/libc2pa_jni.so` — Android JNI wrappers.
- `app/src/native/c2paBridge.ts` — JS FFI wrapper (`signContent`, `signD1`, `signD2`, `computeSignatureHash`).
- `app/src/dataflow/steps/sign.ts` — D1 remote-signing step; drop the whole step, upload the raw MP4 as-is.
- `web/app/api/v1/c2pa-sign/route.ts` — remote signing oracle.
- `web/lib/c2pa-certs.ts` — public cert chain PEM.
- `native/c2pa-bridge/target/` — build artifact, already gitignored but check.

### Title Protocol integration (kill entirely)

- `web/lib/verify/` — the entire client-side TP verification subsystem: `index.ts`, `verify.ts`, `content-resolver.ts`, `config.ts`, `pdq.ts`, `resolvers/indexer.ts`, `checks/cert.ts`, `checks/common.ts`, `checks/core-c2pa.ts`, `checks/image-pdq.ts`, `checks/video-vpdq.ts`, `checks/types.ts`, `README.md`, `server/__tests__/r2.live.test.ts`, `server/__tests__/r2.test.ts`.
- `web/lib/data.ts` — `resolvePageMeta`, `fetchContentRecord`, `verifyContent`; all TP/DAS-based.
- `web/lib/types.ts` — `PageMeta`, `ContentRecord`, `ExtensionNft`; TP verification types.
- `web/lib/supabase.ts` — anon Supabase client for `pages`/`contents`/`users` tables (not the drizzle `clips` table).
- `web/lib/server/page-store.ts` — `createPage`, `findByShortId`, `resolveUser`, `findPagesByUser` on the removed table set.
- `web/lib/server/r2.ts` — `uploadPublic`, `createPresignedPutUrl`, `deletePublic`, `contentKey`/`ogpKey`/`mediaKey`, all for the `rootlens-public` bucket that served TP page thumbnails.
- `web/scripts/verify-video.ts` — one-off TP `verify` request runner.
- `web/scripts/debug-verify.ts` — one-off TP resolver debug.
- `web/scripts/build-license-json.mjs` — generates license JSON files that hang off cNFTs.
- `web/scripts/transparentize.mjs` — one-shot image processing for old LP illustrations; the LP those served is going away.
- `web/public/licenses/` — 4 JSON license bodies served via `rootlens.io/licenses/<type>/<sha256>.json`; referenced only from `web/public/.well-known/tdm.json` + `web/public/robots.txt`.
- `web/public/.well-known/tdm.json` — TDM policy that talks about Bubblegum cNFTs.
- `tools/mock-device/` — entire crate. `main.rs` orchestrates C2PA D1/D2 + blur + R2 + TP `/process` + cNFT mint + `POST /api/clips`. `tp_register.rs`, `cnft_mint.rs`, `clips_register.rs` (with `rootAssetId`/`signedJsonUri`) are directly incompatible with the current server. `c2pa_sign.rs`, `blur.rs`, `jumbf.rs`, `r2_upload.rs`, `signature_hash.rs` all serve the dead pipeline. Even if we want a mock later, the current one is unusable.

### NFT / cNFT / Solana on-chain infrastructure

- `programs/` — entire directory: `license-nft/Cargo.toml`, `license-nft/README.md`, `license-nft/src/lib.rs`, `license-nft/src/error.rs`, `license-nft/src/state.rs`, `license-nft/src/instructions/*.rs` (7 files). Anchor program for License cNFTs + 95/5 USDC revenue split.
- `crates/cli/` — entire directory: `Cargo.toml`, `src/main.rs`, `src/anchor.rs`, `src/config.rs`, `src/error.rs`, `src/rpc.rs`, `src/commands/*.rs` (5 files). `license-cli` for License Collection init + config admin.
- `tests/license-nft/` — entire directory: 4 `.spec.ts` files (audit test suite), `setup.ts`, `setup-alt.ts`, `setup-canopy-tree.ts`, `setup-license-tree.ts`, `create-smoke-tree.ts`, `issue-license.ts`, `issue-helpers.ts`, `helpers.ts`, `regenerate-leaf.ts`, `simulate-issue.ts`, `update-config.ts`, `verify-license-chain.ts`, `README.md`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `fixtures.json`, `fixtures-canopy.json`.
- `tests/staking/` — entire directory: 3 `.spec.ts` files (staking + license-issue E2E), `setup.ts`, `helpers.ts`, `issue-license-helpers.ts`, `package.json`, `tsconfig.json`.
- `Anchor.toml` — Anchor configuration pinning `license_nft` program.
- `Cargo.toml` — root workspace `[workspace] members = ["programs/*", "crates/cli"]`. Once programs/crates go, the file becomes empty; delete it (mock-device and native/c2pa-bridge have their own `[workspace]` breaks).
- `network.json` — Anchor deployment output referencing cNFT collection + USDC mint + config PDA.
- `run_p2.py`, `run_p3.py`, `run_p3.sh`, `relabel.py`, `check_clip.py` — root-level scratch scripts for the abandoned recovery workflow (they read `recovered/raw/` which is gitignored, call Pipeline 2/3 Modal functions that are torn down per task 05).

### Dead LP pages / marketing content

The public site was built for TP-verified content pages. Kill anything that presumed on-chain verification pipes.

- `web/app/[addressOrUsername]/page.tsx` — creator profile page (`resolveUser`, `findPagesByUser`).
- `web/app/p/[shortId]/page.tsx` — content page (`resolvePageMeta` + `ContentPage`).
- `web/app/why-blockchain/page.tsx` — essay on why RootLens uses blockchain.
- `web/app/legal-basis/page.tsx` — essay on legal basis of License NFT.
- `web/app/delete-account/page.tsx` — depends on TP-page account concept and `contact@titleprotocol.org` (wrong domain).
- `web/components/ContentPage.tsx` — 913-line TP verification UI with technical details panel, cNFT asset display, etc.
- `web/components/ContentPage.module.css` — its CSS.
- `web/components/CreatorPage.tsx` — 3-column Instagram-style grid of `pages`.
- `web/components/lp/DeleteAccountPage.tsx` — "Records on the Solana blockchain (compressed NFTs minted via Title Protocol) are immutable...".
- `web/components/lp/LegalBasisPage.tsx` — "NFTを『権利の引換券』" essay.
- `web/components/lp/WhyBlockchainPage.tsx` — blockchain justification essay.
- `web/components/lp/EpisodeListClient.tsx`, `web/components/lp/SyncedVideoPair.tsx`, `web/components/lp/SamplePage.tsx` — the v0.1 LeRobot sample page. **Ambiguous — see §9.** These are alive on rootlens.io/sample.
- `web/components/lp/delete.module.css` — used only by the deleted delete-account page.
- `web/app/safety/page.tsx` — CSAM policy referencing `contact@titleprotocol.org` (wrong domain).

### Root-level cruft

- `rootlens-sample-5h-2026-06-20.zip` — **28 GB**, not a text file; gitignored (`rootlens-sample-*.zip`), so already off git. The file on disk is a local scratch item — user should manually delete.
- All `.DS_Store` files — 12 tracked, should be gitignored-and-purged: `./`, `tools/`, `progress/`, `web/`, `document/`, `sample/`, `progress/app/`, `progress/promo-video/`, `progress/public/`, `app/ios/`, `web/public/lp/sample/`.
- `tools/macos-blur/.build/` — Swift build artifacts (not gitignored, but likely local dirt). Verify against `.gitignore`: `.gitignore` has `tools/macos-blur/.build/` so this is a working-tree residual.

### Modal Pipeline 2/3 (task 12 § 4 で再編する)

前段の判断: 削除ではなく `tools/modal/score-wilor/` サブディレクトリに移動する。 ただし
`gtsam_eval.py` は CLAUDE.md 61 行目「廃止」 明記なので削除。

---

## 3. Edit in place

### `web/db/schema.ts`

- `web/db/schema.ts:24` — drop `walletPubkey` column def (rename it in a migration to `accountPubkey`; the field is still referenced but conceptually not a Solana wallet).
- `web/db/schema.ts:31-32` — drop `network` column def and default. It's kept "for future v0.1.5 mint destination"; that's dead.
- `web/db/schema.ts:26-28` — rename `signatureHash` to `contentHash` (SHA-256 of raw mp4 bytes, no C2PA involvement) once the migration is written. **Load-bearing — see §8.**
- `web/db/schema.ts:62` — the unique index `(walletPubkey, signatureHash, network)` shrinks to `(accountPubkey, contentHash)`.
- `web/db/schema.ts:69-87` — the entire `tosConsents` table is superseded by `consent_events` (per the v0.1.3 legal spec + `POST /api/v1/consents`). Drop it.

### `web/drizzle/`

- Create new `0003_signature_hash_to_content_hash.sql` — renames `clips.signature_hash` to `clips.content_hash`, renames `clips.wallet_pubkey` to `clips.account_pubkey`, drops `clips.network`, drops `tos_consents` table, drops the corresponding indexes and adds new unique `(account_pubkey, content_hash)`.
- `web/drizzle/0000_clips_init.sql` — leave; it's baseline.
- `web/drizzle/0001_v0_1_4_simplify.sql` — leave; historical.
- `web/drizzle/0002_consent_events.sql` — leave; still active.
- `web/drizzle/meta/0000_snapshot.json` — this contains the old schema snapshot with `root_asset_id`/`signed_json_uri` etc. Since drizzle-kit isn't used (`apply_migrations.mjs` runs SQL directly), the snapshot is dead metadata but harmless. Optionally regenerate with `drizzle-kit generate` for accuracy.

### `web/app/api/clips/route.ts`

- `web/app/api/clips/route.ts:44-52` — rename `signatureHash` schema field to `contentHash`; drop `network` if present.
- `web/app/api/clips/route.ts:82-86` — deduplication query keys change.
- `web/app/api/clips/route.ts:98-108` — insert doesn't set network anymore.

### `web/app/api/clips/[id]/route.ts`, `web/app/api/clips/[id]/media/route.ts`

- Rename all `signatureHash` references to `contentHash`.
- `web/app/api/clips/[id]/media/route.ts:12-40` — the presigned GET currently keys by `signedMp4Key(clip.signatureHash)` which is `raw/<sig>/rgb.mp4`; change to `raw/<contentHash>/rgb.mp4`.

### `web/app/api/v1/raw-uploads/route.ts`

- `web/app/api/v1/raw-uploads/route.ts:22-29` — rename request field `signatureHash` → `contentHash`. Same regex still applies (`^[0-9a-f]{64}$`).

### `web/app/api/v1/consents/route.ts`

- `web/app/api/v1/consents/route.ts:36-42` — `requireAccountPubkey` still applies; `X-Wallet-Pubkey` legacy header should drop, but that is server-only. Cosmetic.

### `web/app/api/v1/delete-account/route.ts`

- **Whole route** currently references `users`, `pages`, `contents` tables (Supabase, not drizzle) — none of which are in the current `web/db/schema.ts`. Either rewrite to delete `clips` + `consent_events` for the given `accountPubkey`, or delete outright (§2). The App Store requires an account-deletion path, so likely **rewrite** rather than delete.

### `web/lib/mapper.ts`

- `web/lib/mapper.ts:8-23` — `clipToDto` uses `row.signatureHash`; rename.

### `web/lib/auth.ts`

- `web/lib/auth.ts:9-19` — drop `X-Wallet-Pubkey` legacy header fallback (line 10-11 read both). It's a small tidy; the app has already been switched.

### `web/lib/r2.ts` / `web/lib/r2-keys.ts`

- `web/lib/r2.ts:11-46` — remove `signedMp4Key` name (it's a C2PA concept) — rename to `rawMp4Key`. Same underlying key path.
- `web/lib/r2-keys.ts:12-17` — `rawSessionPrefix(signatureHash)` param name → `contentHash`; `RecordingConfigId` fine.
- `web/lib/r2-keys.ts:51-58` — same for `rawSessionFileKey`, `signedMp4Key`.

### `web/shared/api-types.ts`

- Rename `signatureHash` → `contentHash` on `ClipDto`, `CreateClipRequest`, `RawUploadsRequest`.
- Drop `ClipState = 'uploading'|'uploaded'|'error'` unchanged.

### `web/next.config.ts`

- `web/next.config.ts:2-13` — the entire file is only there to `withWorkflow(withNextIntl(nextConfig))`. Since `web/app/.well-known/workflow/v1/` has empty `"workflows": {}` (task 05 removed the WDK workflow), the `withWorkflow` wrapper is dead. Simplify to `export default withNextIntl(nextConfig);` and remove `workflow` from `web/package.json` deps.

### `web/package.json`

Remove these dependencies (they only serve dead code):
- `@aws-sdk/client-kms` — only used in `web/lib/verify/`
- `@peculiar/asn1-schema`, `@peculiar/x509` — only in `web/lib/verify/`
- `@solana/web3.js` — only in `web/lib/verify/config.ts` + scripts
- `@title-protocol/sdk` — only in `web/lib/verify/` + scripts
- `asn1js` — only in `web/lib/verify/`
- `bs58` — only in `web/lib/verify/checks/common.ts`
- `canonicalize` — only in `web/lib/verify/checks/common.ts`
- `cbor-x` — only in `web/lib/verify/`
- `mp4box` — only in `web/lib/verify/pdq.ts`
- `sharp` — only in `web/scripts/transparentize.mjs`
- `workflow` — see `next.config.ts` above

Keep: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@ffmpeg/*` (need to verify — see §9), `@supabase/supabase-js` (still used by `delete-account`, but see §2), `drizzle-orm`, `postgres`, `next`, `react`, `next-intl`, `zod`.

### `web/app/.well-known/workflow/v1/`

- Directory contains WDK boilerplate files (`config.json`, `manifest.json`, `flow/route.js`, `step/route.js`, `webhook/[token]/route.js` + `.debug.json` siblings, `.gitignore`). `manifest.json` has `"workflows": {}` — nothing is registered. **Delete the whole directory** since the `workflow` package will be uninstalled and next.config.ts will drop `withWorkflow`.

### `web/messages/ja.json` and `web/messages/en.json`

Total 215+ dead keys per language. Sections to delete outright:
- `pages.whyBlockchain.*`, `pages.legalBasis.*` (LP essays being deleted)
- `pages.home.closingTitle`, `pages.home.closingDesc`, `pages.home.closingCtaWhy`, `pages.home.whyBlockchainLink`, `pages.home.*` sections referring to the old app-flow diagram
- `pages.technology.*`, `pages.why.*`, `pages.developers.*`, `pages.about.*` (LP nav still present)
- `pages.sample.*` — **KEEP if the `/sample` page stays** (§9)
- `lp.hero.*`, `lp.problem.*`, `lp.appFlow.*`, `lp.issues.*` — used by `HomePage.tsx`. If HomePage is rewritten these need review. **Ambiguous**.
- `lp.c2pa.*`, `lp.gap.*`, `lp.tp.*`, `lp.comparison.*`, `lp.rootlens.*`, `lp.openSource.*`, `lp.footer.*`
- `content.*` (used by `ContentPage.tsx`, deleting)
- `field.*` (used by `ContentPage.tsx` verification data table)
- `diagram.c2paTitle`, `diagram.tpTitle`, `diagram.step1-4`
- `notfound.*` — depends on 404 UX, keep

### `web/public/llms.txt` and `web/public/robots.txt`

- `web/public/llms.txt` — starts with "verifiable short-form video supplier marketplace on Solana. Each video is bound to a Bubblegum cNFT...". Rewrite to say what RootLens actually is now.
- `web/public/robots.txt` — mentions "user-generated short-form video bound to Solana cNFTs". Simplify.

### `web/app/layout.tsx`

- `web/app/layout.tsx:47` — description `"Prove it's real."` — old TP tagline. Rewrite.

### `README.md` (root)

- `README.md:23-28` — the "How it works" section explicitly names "C2PA (Adobe/Google/Microsoft)", "Root NFT on Solana", "Stake your Root NFT", "License NFT". All dead. Rewrite.
- `README.md:32-38` — the Stack section names "C2PA signing", "cloud TEE", "Solana", "Privy". Rewrite.
- `README.md:41-45` — "Built on Title Protocol, C2PA, Solana". Delete.

### `CLAUDE.md` (root)

- `CLAUDE.md` is the still-active operator guide. It says "current phase v0.1.3" but v0.1.4 tasks 01-11 are largely done. Update to match reality: kill mentions of C2PA D1/D2, TP `/process`, cNFT, `rootAssetId`, `signedJsonUri`. Rewrite the Pipeline table (§3) to reflect the v0.1.4 flow (capture → raw upload; no server post-processing until v0.1.5+).
- `CLAUDE.md:11` — remove Title Protocol sibling-repo mention.
- `CLAUDE.md:20-23` — remove `native/c2pa-bridge/`, `programs/`, `crates/`, `tests/` lines.
- `CLAUDE.md:48-63` — Pipeline table needs full rewrite; drop the "TP register + cNFT" cell and the Pipeline 2/3 rows if per §9 those are also killed.
- `CLAUDE.md:97-110` — "Key Design Decisions" section on TP register + cNFT — delete.
- `CLAUDE.md:107-110` — "オフチェーンストレージ" section — no longer relevant.

### `.gitignore` (root)

- `.gitignore:41` — `native/c2pa-bridge/target/` can go with the crate.
- `.gitignore:60-79` — the whole `# Solana / Anchor` block including `network.json`, `target/`, `test-ledger/`, program keypair paths, License Collection keypair paths, `tests/license-nft/fixtures*.json`, `references/` (partially).
- `.gitignore:83` — `app/modules/hand-pose/android/build/` fine to keep.

### `web/.env.example`

- Delete rows for `NEXT_PUBLIC_DAS_RPC_URL`, `SOLANA_RPC_URL`, `ROOT_CA_CERT_PEM`, `IOS_INTERMEDIATE_CA_CERT_PEM`, `ANDROID_INTERMEDIATE_CA_CERT_PEM`, `OPERATOR_WALLET_JSON`, `LICENSE_NFT_PROGRAM_ID`, `LICENSE_NFT_CONFIG_PDA`, `LICENSE_MERKLE_TREE`, `LICENSE_NFT_ALT`, `COSIGN_CATALOG_PATH`, `LICENSE_NAME`, `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`, `SUPABASE_URL/SERVICE_ROLE_KEY` (Supabase used only by `web/lib/supabase.ts` + `page-store.ts` + `delete-account`), `MODAL_*_ENDPOINT` (all 5), `TP_NETWORK`, `ROOTLENS_TOS_VERSION/HASH`, `ROOTLENS_COSIGN_DELEGATE`, `APPLE_PUSH_*` (unused), `ANTHROPIC_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY` (only used by dead scoring layers), `R2_PUBLIC_BUCKET / R2_PUBLIC_URL / R2_BUCKET_PROCESSED` (only Pipeline 2/3 output).
- Keep: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_RAW`, `R2_BUCKET_RAW_ARKIT` (new in task 07), `R2_BUCKET_FPVLABS` (task 08), `DATABASE_URL`, `C2PA_SIGN_KEY_B64` (goes with C2PA delete).

### `web/i18n/request.ts`

- Not read but likely just returns messages. If we prune messages, still works but needs a check.

### App-side edits

Because the app has already been through v0.1.4 (task 03), the dataflow is 3-step (unsigned → signed → registered). We now compress to 2 stages: `recorded → uploaded`. Skipping D1 means:

- `app/src/dataflow/pipeline.ts:16-56` — `advanceClip` currently branches on `stage in ('unsigned','signed','registered')`. Simplify: `unsigned → upload+register → registered`. Drop `signRecording`, `signedUriIn`, `effectiveStage` inspection for the `signed` intermediate.
- `app/src/dataflow/pipeline.ts:189-286` — `advanceClip` body.
- `app/src/dataflow/types.ts:16-25` — `Pipeline1Stage = 'unsigned' | 'registered'` (no 'signed' middle).
- `app/src/dataflow/types.ts:69-80` — `SignInput`/`SignResult` types delete outright.
- `app/src/dataflow/steps/index.ts` — drop the sign re-exports.
- `app/src/dataflow/steps/upload.ts` — the primary video file is now the raw mp4 (no D1), not `signedUriIn(workDir)`. Adjust caller.
- `app/src/dataflow/steps/register.ts` — rename body field `signatureHash` → `contentHash`.
- `app/src/dataflow/steps/list.ts:26-35` — rename `ServerClipStatus.signatureHash` → `contentHash`.
- `app/src/dataflow/store.ts:111-121` — `renameClipId(localId, signatureHash)` becomes `renameClipId(localId, contentHash)`.
- `app/src/dataflow/index.ts` — drop `signClip`, `signRecording`, `makeSignTmpDir`, `signedUriIn` from exports.
- `app/src/env.ts:33-37` — `SIGN_SERVICE_URL` env drops.
- `app/App.tsx:23` — no code change here, but `RootNavigator` shouldn't need updates.
- `app/package.json:28-70` — drop `@title-protocol/sdk` (unused in app source), `viem` (unused in app source per grep), `bs58` (only used by DebugAuthProvider — see next), `expo-speech`, `expo-camera` review, `expo-av` review. Keep: `@noble/curves`, `@noble/hashes`, `expo-secure-store`, others active.
  - **Load-bearing**: `bs58` is still used by `app/src/services/auth/DebugAuthProvider.ts:15`. Keep unless auth is also rewritten. Rename doesn't reduce dependency; just check it's used exactly there.

### App files that go with the D1 delete

- Rename `app/modules/c2pa-bridge/expo-module.config.json` — delete along with the module.

### Tools

- `tools/smoke-test.sh` — entire file is v0.1.3 flow (mock-device → TP `/process` → cNFT mint → `finalize` → poll → Modal `wilor`). Delete outright — no compatible replacement exists.
- `tools/gen-dummy-sensors.py` — was for mock-device inputs. **Ambiguous** — could still be useful for testing raw uploads if someone rewrites the mock. Flag for §9. **Task 12 判断**: mock-device と一緒に削除。
- `tools/lp-sample/*.py` — 6 files. All operate on the v0.1 LeRobot LP sample. Their outputs are `web/public/lp/sample/dataset/*` (still on git, still active). **Keep** if `/sample/v0.1` page stays. **Task 12 判断**: `/sample` 継続なので keep。
- `tools/asset-gen/gen-sfx.py` — regenerates capture SFX. Keep.
- `tools/asset-gen/generate-task-illustrations.mjs` — one-off LP illustration generator. Ambiguous; **§11**.
- `tools/egoblur_probe.py` — user-flagged as active. **Keep.**
- `tools/fpvlabs-handoff/*` — active user tooling. **Keep.**
- `tools/macos-blur/` — was only invoked from `tools/mock-device/src/blur.rs`. Once mock-device dies, macos-blur has no caller. But it's a general Apple Vision face-blur CLI that could be re-used. **Ambiguous — §9.** **Task 12 判断**: 削除 (「オンデバイス blur はもうやらない」)。

### Documentation

- `document/v0.1.3/DATA_SPECS_JA.md` — frozen historical spec. **Leave** per user rule. Note the code no longer matches it, that's expected for a frozen version.
- `document/v0.1.3/UI_SPECS_JA.md` — same, historical.
- `document/v0.1.3/tasks/*/README.md` — historical.
- `document/v0.1.4/tasks/*/README.md` — mostly done; the v0.1.4 spec `DATA_SPECS_JA.md` is empty (only `# RootLens v0.1.4 データパイプライン仕様書`). **Edit** the spec to be actually filled in with the new post-cleanup contract.

---

## 4. DB / schema changes

Single forward-only migration `0003_deblockchain_and_content_hash.sql`:

```sql
BEGIN;

-- rename primary domain key: signature_hash → content_hash
-- (signature_hash was SHA-256 of C2PA D2 signature; content_hash will be SHA-256 of raw mp4 bytes)
ALTER TABLE "clips" RENAME COLUMN "signature_hash" TO "content_hash";

-- rename ownership key: wallet_pubkey → account_pubkey (Ed25519 pubkey, base58, no Solana meaning)
ALTER TABLE "clips" RENAME COLUMN "wallet_pubkey" TO "account_pubkey";

-- drop network column (was for future cNFT mint destination)
ALTER TABLE "clips" DROP COLUMN IF EXISTS "network";

-- rebuild unique index
DROP INDEX IF EXISTS "clips_wallet_sig_network_uq";
DROP INDEX IF EXISTS "clips_wallet_idx";
DROP INDEX IF EXISTS "clips_signature_hash_idx";
CREATE INDEX "clips_account_idx" ON "clips" USING btree ("account_pubkey");
CREATE INDEX "clips_content_hash_idx" ON "clips" USING btree ("content_hash");
CREATE UNIQUE INDEX "clips_account_content_uq" ON "clips" USING btree ("account_pubkey", "content_hash");

-- drop tos_consents (superseded by consent_events in 0002)
DROP TABLE IF EXISTS "tos_consents";

COMMIT;
```

**Sequencing constraint:** The application code must be renamed to use `contentHash` / `accountPubkey` **before** the migration is applied, because on Vercel the app boots against the DB schema. Or, run the migration first with `content_hash` and `account_pubkey` as *aliased views* (add a computed column), then flip the code, then drop the old names. Given the app is dev-only right now, straight rename is fine — a small window of 500s is acceptable.

**Existing tables not in `schema.ts`**: `web/lib/server/page-store.ts` calls `users`, `pages`, `contents`, `cnft_assets` tables. Also `web/app/api/v1/delete-account/route.ts` uses them. These tables likely still exist in Supabase from the old TP-page product. After deleting `page-store.ts` + `delete-account`, either drop these tables via a separate migration or leave them dormant (they aren't touched by any remaining code). Recommend a follow-up `0004_drop_lp_tables.sql`.

---

## 5. API contract breaks

Every field rename below is a **breaking change** — old builds of the app will 400/500 against new server, and vice versa.

| Endpoint | Change |
|---|---|
| `POST /api/clips` | Request field: `signatureHash` → `contentHash`. `network` field removed. |
| `GET /api/clips` | Response `ClipDto.signatureHash` → `contentHash`. |
| `GET /api/clips/:id` | Same. |
| `GET /api/clips/:id/media` | Path unchanged, response unchanged, but internal keying changes. |
| `DELETE /api/clips/:id` | Response unchanged. |
| `POST /api/v1/raw-uploads` | Request field: `signatureHash` → `contentHash`. Response `files` map unchanged. |
| `GET /api/v1/c2pa-sign` | **Route deleted.** Old app builds calling this hit 404 during their "sign" step and error. Must roll new app first, then delete server. |
| `POST /api/v1/c2pa-sign` | Same. |
| `POST /api/v1/consents` | Request `subjectPubkey` header is now `X-Account-Pubkey` only (drop `X-Wallet-Pubkey` fallback). No shape change. |
| `POST /api/v1/delete-account` | **If deleted**: iOS App Store review will fail. **Recommend rewrite** to delete `clips` + `consent_events` for the given `X-Account-Pubkey`. |
| `POST /api/clips/:id/finalize`, `POST /api/clips/:id/stake`, `POST /api/clips/:id/retry`, `POST /api/v1/tp-*` | Already deleted per v0.1.4 task 02. |

App-side headers: The app currently sends `X-Account-Pubkey`; the server reads either (`auth.ts:10-11`). Drop legacy silently.

---

## 6. Impact / risk map

### C2PA D1 subsystem removal

Callers (Layer 2 → Layer 1):
- `app/src/dataflow/pipeline.ts:189-234` — `advanceClip` calls `signRecording` before upload. Replacement: compute `sha256(rawMp4)` on-device (already trivially available via `expo-crypto` or the existing `computeSignatureHash` renamed to `computeContentHash`).
- `app/src/dataflow/steps/sign.ts:59-108` — the step itself.
- `app/src/native/c2paBridge.ts` — `signD1`, `computeSignatureHash`. The `computeSignatureHash` JS wrapper (line 189-192) actually calls `C2paBridge.computeContentId(inputMp4)` — this native method reads JUMBF signature bytes and hashes them; it can't be reused for raw-mp4 hashing.

**Replacement**: `sha256(file_bytes)` via `expo-crypto.digestStringAsync(SHA256, file_bytes)` — needs streaming for GB-scale mp4. Since `expo-file-system` doesn't stream well, may need to add a small native module. Or accept the cost by loading the whole file to memory (blocked at ~4GB uploads).

Recommendation: use ffmpeg's `-md5` on-device via native, or compute the hash chunk-by-chunk in Rust in a smaller native module. The `native/c2pa-bridge` crate has JUMBF parsing that can go, but the SHA-256 machinery is useful. Consider keeping just a `sha256_of_file` FFI stub.

### `signature_hash` → `content_hash` R2 key change

Every existing raw upload lives at `raw/<signature_hash>/rgb.mp4` where `signature_hash` was SHA-256 of C2PA D2 (now D1) signature. After the switch:
- new uploads go to `raw/<sha256_of_raw_mp4>/rgb.mp4`
- old data is orphaned in R2 under the old key path

Since v0.1.4 doesn't process the old data (no scoring, no dataset), the orphans are R2 storage cost only. `fpvlabs-handoff` still reads old paths — need to reconcile.

### `programs/` + `crates/` + `tests/*` removal

- Root `Cargo.toml` has `[workspace] members = ["programs/*", "crates/cli"]`. Deleting these directories requires deleting `Cargo.toml` (`mock-device` and `native/c2pa-bridge` are `[workspace]`-broken already, so their builds are unaffected). After deletion `cargo build` at the root should just error "no manifest" or be a no-op.
- `Anchor.toml`, `network.json` — self-contained, no runtime references.
- `keys/dev/solana/deployer.json` — referenced by `tools/smoke-test.sh` (deleted) and `tools/mock-device/src/main.rs` (deleted). No remaining references.

### LP verification tree removal

- `web/lib/verify/`: 12 files, ~1200 lines of code. Callers: `web/lib/data.ts` (deleted) and `web/scripts/{debug-verify,verify-video}.ts` (deleted).
- `web/lib/data.ts`: `resolvePageMeta` called only by `web/app/p/[shortId]/page.tsx` (deleted). `fetchContentRecord` + `verifyContent` called only by `web/components/ContentPage.tsx` (deleted).
- `web/lib/supabase.ts`: exported `supabase` client used by `web/lib/data.ts` (deleted) and `web/lib/verify/resolvers/indexer.ts` (deleted).
- `web/lib/server/page-store.ts`: called by `web/app/[addressOrUsername]/page.tsx` (deleted) and `web/app/api/v1/delete-account/route.ts` (rewritten).
- `web/lib/server/r2.ts`: `uploadPublic`, `deletePublic`, `keyForContentHash`, `objectExists` — called by `web/app/api/v1/delete-account/route.ts` (rewritten to not need them).
- Removing the imports collapses to nothing else in the codebase.

### `tools/mock-device` removal

- `tools/smoke-test.sh` deletes with it.
- `web/`: no direct dependency (mock-device calls web endpoints, not the reverse).
- No workspace parent (has its own empty `[workspace]`).

### Modal Pipeline 2/3 (task 12 §4 で再編)

前段の判断: 削除ではなく `tools/modal/score-wilor/` に移動して legacy pipeline として保持。
`gtsam_eval.py` のみ削除。 fpvlabs は `tools/modal/fpvlabs/` に移動。

---

## 7. Suggested sequencing of PRs

1. **PR 1 — Docs update** (low risk). Rewrite `README.md`, `CLAUDE.md`, `web/public/llms.txt`, `web/public/robots.txt` to match the intended v0.1.5 vision (data collection + FPV handoff, no C2PA/blockchain). Update `document/v0.1.4/DATA_SPECS_JA.md` with the actual spec. Nothing breaks.

2. **PR 2 — Delete dead-LP surfaces**. Delete:
   - `web/lib/verify/` tree
   - `web/lib/data.ts`, `web/lib/types.ts`, `web/lib/supabase.ts`, `web/lib/server/page-store.ts`, `web/lib/server/r2.ts`
   - `web/app/[addressOrUsername]/page.tsx`, `web/app/p/[shortId]/page.tsx`, `web/app/why-blockchain/page.tsx`, `web/app/legal-basis/page.tsx`
   - `web/app/delete-account/page.tsx` (deferred if delete-account is being rewritten in same PR)
   - `web/components/ContentPage.tsx`, `web/components/CreatorPage.tsx`, `web/components/lp/{ContentPage.module.css,DeleteAccountPage.tsx,LegalBasisPage.tsx,WhyBlockchainPage.tsx,delete.module.css}`
   - `web/scripts/{build-license-json.mjs,debug-verify.ts,verify-video.ts,transparentize.mjs}`
   - `web/public/licenses/`, `web/public/.well-known/tdm.json`
   - `web/app/api/v1/delete-account/route.ts` (rewrite in same PR to a minimal drizzle-based deletion)
   - Prune matching entries from `web/messages/{ja,en}.json`
   - Remove `@aws-sdk/client-kms`, `@peculiar/*`, `@solana/web3.js`, `@title-protocol/sdk`, `asn1js`, `bs58`, `canonicalize`, `cbor-x`, `mp4box`, `sharp` from `web/package.json`
   - Verify `web` build green.

3. **PR 3 — Delete WDK workflow scaffolding**. Delete `web/app/.well-known/workflow/v1/`; remove `withWorkflow` from `next.config.ts`; drop `workflow` from `web/package.json`.

4. **PR 4 — Delete Anchor programs + license CLI + related tests**. Delete `programs/`, `crates/`, `tests/`, `Anchor.toml`, root `Cargo.toml`, `network.json`. Update root `.gitignore`.

5. **PR 5 — Delete mock-device + smoke-test + gen-dummy-sensors + macos-blur**. Delete `tools/mock-device/`, `tools/smoke-test.sh`, `tools/gen-dummy-sensors.py`, `tools/macos-blur/`. Delete `run_p2.py`, `run_p3.py`, `run_p3.sh`, `relabel.py`, `check_clip.py`.

6. **PR 6 — Rewrite CLAUDE.md and docs** (definitive). Reflect the post-cleanup topology.

7. **PR 7 — App: drop `@title-protocol/sdk` from deps and confirm unused imports gone**. Just deps; small.

8. **PR 8 — DB migration + code rename (breaking)**. This is the coordinated one:
   1. Write `0003_deblockchain_and_content_hash.sql`.
   2. In `web/db/schema.ts`, `web/lib/mapper.ts`, `web/lib/r2.ts`, `web/lib/r2-keys.ts`, `web/shared/api-types.ts`, `web/app/api/**/route.ts`: rename `signatureHash` → `contentHash`, `walletPubkey` → `accountPubkey`. Remove `network`.
   3. In `app/src/**`: same renames.
   4. Apply migration to Supabase manually via `node web/scripts/apply_one_migration.mjs 0003_deblockchain_and_content_hash.sql`.
   5. Deploy web + roll app build. Coordinated deploy — 5-minute service window.
   6. Existing R2 raw uploads with the old `signature_hash` key stay orphaned (documented).

9. **PR 9 — Delete C2PA D1 signing subsystem + privacy-blur**. Delete:
   - `native/c2pa-bridge/`
   - `app/modules/c2pa-bridge/` (Expo module + its `.a` libs)
   - `app/modules/privacy-blur/` + `app/src/units/privacy-blur/`
   - `app/src/native/c2paBridge.ts`
   - `app/src/dataflow/steps/sign.ts`
   - `web/app/api/v1/c2pa-sign/`, `web/lib/c2pa-certs.ts`
   - Update `app/src/dataflow/pipeline.ts` to skip the sign step (upload raw mp4 directly).
   - Update `app/src/dataflow/types.ts`, `store.ts`, `index.ts` accordingly.
   - Add a new content-hash step (`sha256_of_file`).
   - Rebuild iOS + Android; ship new app build.

10. **PR 10 — Modal pipeline reorg**. Move `tools/modal/` 直下の score-wilor 一味 (`layer1_metadata.py`, `layer2_frame_sampling.py`, `layer3_vlm.py`, `wilor.py`, `pipeline2.py`, `r2ctx.py`, `labeling/`, `preprocess/`, `scoring/`) を `tools/modal/score-wilor/` へ移動。 `fpvlabs.py` を `tools/modal/fpvlabs/fpvlabs.py` へ移動。 `gtsam_eval.py` は削除。 `tools/fpvlabs-handoff/list_pending.py` と `RUNBOOK.md` の `modal run` パスを新場所に更新。 Modal deploy を新 path で 1 回打つ。

Each PR passes tsc, tests (what remains), and Vercel build.

---

## 8. Files where dead concepts are load-bearing

- **`signature_hash` field** is present in ~50 files across web + app + tools + document. It's the primary R2 key, DB PK component, ClipDto identity, and API contract. Any rename requires the coordinated migration in PR 8.
- **`account_pubkey` header** is read by `web/lib/auth.ts` with dual fallback (`X-Wallet-Pubkey` legacy). Multiple API routes call `requireAccountPubkey`: `web/app/api/clips/route.ts`, `web/app/api/clips/[id]/route.ts`, `web/app/api/clips/[id]/media/route.ts`, `web/app/api/v1/consents/route.ts`, `web/app/api/v1/c2pa-sign/route.ts`. All chain to the same helper.
- **`AuthSession.pubkey`** — `app/src/services/auth/AuthContext.tsx`, `app/src/dataflow/pipeline.ts`, `app/src/dataflow/steps/list.ts`, `app/src/dataflow/steps/sign.ts`, `app/src/dataflow/steps/register.ts` all read `session.pubkey`. Naming stays `pubkey` since it's still the Ed25519 pubkey; only the header name and DB column change.
- **`bs58` in app/**: only used by `DebugAuthProvider.ts`. Removing bs58 requires switching debug key encoding — bigger refactor. Recommend keeping bs58.
- **v0.1.4 documented "future v0.1.5 mint" everywhere**: comments in `web/db/schema.ts:6-13`, `web/drizzle/0001_v0_1_4_simplify.sql:6-7`, `document/v0.1.4/tasks/*/README.md`. Rewrite these comments to say "removed in cleanup, not reintroducing".
- **Content-hash key in R2**: `web/lib/r2.ts`, `web/lib/r2-keys.ts`, `tools/modal/fpvlabs.py:812-826`, `tools/fpvlabs-handoff/list_pending.py`, and the entire fpvlabs handoff spec key on this. Renaming `signature_hash` → `content_hash` affects fpvlabs too.

---

## 9. Ambiguity list (task 12 判断で解消済)

- **`/sample` and `/sample/v0.1(.3)` LP pages**: **KEEP** (user 判断)。 `tools/lp-sample/`、 `web/public/lp/sample/` も残す。
- **`web/components/lp/HomePage.tsx`**: **放置** (user 判断、 文章書き換えが大変)。 Solana 語彙が LP に残るが許容。
- **`web/app/safety/page.tsx`**: contact 誤記のみ修正、 それ以外は放置。
- **Pipeline 2/3 Modal**: `tools/modal/score-wilor/` に移動して legacy として残す (task 12 §4)。 削除しない。
- **`tools/macos-blur/`**: **削除** (「オンデバイス blur はもうやらない」)。
- **`tools/gen-dummy-sensors.py`**: **削除** (mock-device 一緒に消えるので単体では無意味)。
- **`tools/asset-gen/generate-task-illustrations.mjs`**: 参照される asset パス (`assets/sandbox-04/tasks/*/`) が既に無い。 削除。
- **`keys/`**: **物理削除しない** (user 判断)。 .gitignore 済で git には元々無い。 ローカルに残置。
- **`app/src/units/privacy-blur/`**: **削除** (「オンデバイス blur はもうやらない」)。 `app/modules/privacy-blur/` も。
- **`app/src/services/auth/DebugAuthProvider.ts` の `STORAGE_KEY = 'rootlens.debug_wallet.v1'`**: そのまま残す (既存端末の鍵を保持)。 内部の "wallet" 語彙は debug 用なので許容。
- **App-side `expo-speech`, `expo-camera`, `expo-av`, `expo-media-library`**: 全て active (task 07 で復活のため)。 keep。
- **`tests/staking/03-api-license-issue.spec.ts`**: 参照先の `/api/v1/license/issue` が task 02 で削除済み。 tests/ ディレクトリごと削除で解消。
- **`web/lib/server/__tests__/r2.live.test.ts` + `r2.test.ts`**: 削除 (r2.ts と一緒に)。
- **`web/scripts/r2_inspect.mjs`**: keep (R2_BUCKET_RAW 向けの汎用 utility として)。
- **`web/scripts/apply_one_migration.mjs` + `apply_migrations.mjs`**: keep (現役)。
- **`app/scripts/gen-legal.mjs` vs `web/scripts/gen-legal.mjs`**: 両方 keep (別々の legalDocs.generated.ts を生成する現役)。

---

## 10. Historical specs cross-references

Places in current code that cite frozen specs from v0.1.0-v0.1.2:

- `programs/license-nft/README.md:7` → `document/v0.1.2/SPECS_JA.md §5` (spec was correct for v0.1.2; deleting the code makes this moot).
- `programs/license-nft/src/lib.rs:3-4` → `document/v0.1.2/SPECS_JA.md §5` (same).
- `native/c2pa-bridge/src/lib.rs:2,451,564` → `仕様書 §4.6 / §4.5`. This is the older v0.1.0 spec. Deleting the crate makes moot.
- `web/lib/server/page-store.ts:1-6` → `仕様書 §7.1 URL構造, §10.4 データベース設計`. Deleting the file makes moot.
- `web/lib/server/r2.ts:1-7` → `仕様書 §6.2 パイプラインB`. Same.
- `web/scripts/build-license-json.mjs:5-6` → `SPECS_JA §5.5.3`. Deleting file.
- `tests/license-nft/verify-license-chain.ts:3-4` → `SPECS_JA §5.5.3`. Deleting.
- `document/v0.1.4/tasks/07-manual-upload-landscape-arkit/README.md:70-72` explicitly says "crates/ (license-cli) + programs/ (Anchor) は v0.1.4 では未使用だが v0.1.5 の mint 再配線で使うためリポに残置". This claim is now invalidated by the user's 2026-07-09 statement. Task 07 needs an amendment noting the cleanup.

**Historical docs (`document/v0.1.0-v0.1.2/`) themselves**: DO NOT edit per user rule. The v0.1.0-v0.1.2 specs describe C2PA + Title Protocol + NFT thoroughly — that's their frozen record of what v0.1.0-v0.1.2 was. Leave.

---

## 11. Recently-added experimental tools

- `tools/egoblur_probe.py` — **KEEP** per user statement in the audit prompt. Reviewed for residue: file imports `stera-sdk` from `references/stera-sdk/src` (external), Meta EgoBlur gen2 model, cv2. It's a clean probe harness. Zero references to C2PA/TP/NFT/Solana. No cleanup needed.

- **`tools/blur_dryrun.py`**: does not exist per file enumeration. Nothing to audit.

- **Scratch dir**: root-level `check_clip.py`, `network.json`, `relabel.py`, `run_p2.py`, `run_p3.py`, `run_p3.sh` are all v0.1.3 recovery-workflow scratch, keying on `recovered/raw/` (gitignored) which is user's private mp4 dump. Delete all outright per §2.

- **`tools/gen-dummy-sensors.py`**: mock-device input generator, no future caller. Delete per §2 unless a new mock is planned. **Task 12 判断**: 削除。

---

## 12. Config / env / dependencies

### `Cargo.toml` (root) — delete after PR 4.

### `web/package.json` deps to remove (see §3 for details):
- `@aws-sdk/client-kms`, `@peculiar/asn1-schema`, `@peculiar/x509`, `@solana/web3.js`, `@title-protocol/sdk`, `asn1js`, `bs58`, `canonicalize`, `cbor-x`, `mp4box`, `sharp`, `workflow`

### `web/package.json` deps to review (may or may not stay depending on §9):
- `@ffmpeg/ffmpeg`, `@ffmpeg/util` — only used in scripts we're deleting? Grep confirms no runtime use.
- `@supabase/supabase-js` — used by `web/lib/supabase.ts` (deleted), `web/lib/server/page-store.ts` (deleted), and `web/app/api/v1/delete-account/route.ts` (rewritten off drizzle). Can drop.
- `yaml` — grep to confirm if used.

### `app/package.json` deps to remove:
- `@title-protocol/sdk` — grep app/src for uses. Confirmed unused per §3 grep.
- `viem` — grep app/src for uses. Confirmed unused per §3 grep.

### `app/package.json` deps to review:
- `expo-speech`, `expo-av` — currently active (§7 task 07).
- `@shopify/react-native-skia` — check.

### `web/.env.example` — see §3.

### `web/vercel.json`, `web/vitest.config.ts`, `web/eslint.config.mjs`, `web/tsconfig.json` — untouched.

### `web/tsconfig.tsbuildinfo` — build cache; auto-regenerated.

### `.claude/settings.local.json` — user-local claude permissions, not touched.

### Removed env vars in `web/.env` (if you keep it in secrets):
- Solana / Anthropic / Gemini / OpenAI / Root CA / TP gateway / license NFT constants / MODAL endpoints / APPLE_PUSH / OPERATOR_WALLET / cosign delegate / TP network → all can go.
