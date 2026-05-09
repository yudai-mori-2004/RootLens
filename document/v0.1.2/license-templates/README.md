# License Terms Templates

Templates for the legal text that the License NFT URI (§5.2 / §5.5) points to,
parameterized by license type.

> **These are pre-review drafts.** Before mainnet deployment, they must be
> reviewed by qualified counsel together with the §4.4 ToS in `SPECS_JA.md`.
> The two documents form a single legal package and must be reviewed jointly.

## Language and governing law

All public-facing license text is in **English** because:

- Licensees are global (US, EU, APAC AI companies)
- All major NFT-licensing precedents (Token-Bound NFT License by Grimmelmann
  2022; a16z "Can't Be Evil"; Creative Commons canonical) are in English
- DAS indexers, NFT marketplaces, and verification tools assume English
  metadata

Default governing law: **Singapore** with **SIAC arbitration**.

Rationale:
- Neutral forum (no party's home court advantage)
- English-language proceedings
- Well-developed copyright + digital-asset jurisprudence
- Singapore International Arbitration Centre is among the most respected
  international arbitration institutions globally
- Acceptable to both Asian originator (RootLens, JP) and Western counterparties
  (US AI companies)

If a Japan-domestic equivalent is later required, add a parallel template
`commercial-jp-v1` with Japanese text and Japan governing law. The on-chain
program is jurisdiction-agnostic; switching license URL is the only change.

## Design principles (consistent with SPECS §5.5)

- **Unilateral grant** (§5.5.1) — license, not contract; no clickthrough
  required; License NFT holder automatically becomes licensee
- **Legal-Authoritative** (§5.5.2) — chain state is the default record of
  ownership, but courts may correct ownership in cases of theft or fraud
- The only difference between license types is **scope of permitted use**.
  Everything else (unilateral grant structure, Legal-Authoritative,
  Root-NFT binding verification procedure, governing law, dispute resolution)
  is common across all templates.

## Available license types

| Type ID | Use | File |
|---|---|---|
| `commercial-v1` | Full commercial use (AI training + commercial operation + derivatives) | [commercial-v1.txt](commercial-v1.txt) |
| `training-only-v1` | AI / ML training only (no external distribution; trained model survives license termination) | [training-only-v1.txt](training-only-v1.txt) |
| `non-commercial-v1` | Non-commercial only (research, education, personal) | [non-commercial-v1.txt](non-commercial-v1.txt) |
| `redistribution-v1` | Commercial + redistribution (Creative-Commons-Share-Alike-style viral propagation) | [redistribution-v1.txt](redistribution-v1.txt) |

To add a new type: create the new `.txt`, compute its `keccak256` hash,
upload to immutable R2 storage, register in the RootLens API allowlist.
No on-chain program change is required.

## Hash and URL structure

Each `.txt` file's `keccak256` hash (32 bytes, hex) is its unique identity.

```bash
# Compute hash
keccak256sum commercial-v1.txt
# → e.g. 0xa7c3...0x5b91

# Self-certifying URL after R2 deployment
https://rootlens.io/licenses/commercial-v1/0xa7c3...0x5b91.txt
```

The License NFT's `MetadataArgsV2.uri` points to a JSON wrapper at the
parallel URL:

```
https://rootlens.io/licenses/commercial-v1/0xa7c3...0x5b91.json
```

The JSON wrapper contains both `license_text_url` and `license_text_hash`,
so any third party can verify
`keccak256(fetch(license_text_url)) == license_text_hash`.

The `issue_license` program appends `?root_mint=<root_asset_id_b58>` to the
URI, so the final URI sealed into the License NFT leaf is:

```
https://rootlens.io/licenses/commercial-v1/0xa7c3...0x5b91.json?root_mint=<root_asset_id_b58>
```

This append cannot be tampered with after mint, because the URI is part of
`MetadataArgsV2`, which feeds into `data_hash`, which is part of the leaf
hash that Bubblegum stores in the Merkle tree.

## JSON wrapper schema

Each `.txt` is wrapped as the following JSON, deployed at the same hash
identifier:

```json
{
  "version": "1.0",
  "license_type_id": "commercial-v1",
  "license_text_url": "https://rootlens.io/licenses/commercial-v1/<terms_hash>.txt",
  "license_text_hash": "0x<terms_hash>",
  "license_text": "...full text inline (verbatim copy of .txt) ...",
  "issuer": {
    "name": "RootLens",
    "rootlens_program_id": "G1PWd1nMe63isDaYT3iijcyWac9d4RE1CBrvaKZFjpV8",
    "license_collection": "BvhuJiTWDW6n5cSzE4XmzYcwLry7vcstS1U7fD7n9N1b"
  },
  "metadata": {
    "name": "RootLens License (Commercial v1.0)",
    "symbol": "RLLIC",
    "description": "Commercial-use license for RootLens-issued data NFT"
  }
}
```

Three-way hash verification:
1. `keccak256(license_text)` must equal `license_text_hash`
2. `license_text_hash` must equal the hash component of the JSON wrapper URL
3. `keccak256(fetch(license_text_url))` must equal the same hash

## Common structure of all templates

All `.txt` files contain the following sections:

1. **Title + version + license_type_id**
2. **Definitions**: Root NFT, License NFT, Licensor, Licensee,
   Subject Content
3. **Grant of license** (varies by type)
4. **Restrictions** (varies by type)
5. **Term** (default: perpetual; some types may be limited)
6. **Transfer of license with NFT** (Legal-Authoritative)
7. **Warranty disclaimer**
8. **Limitation of liability**
9. **Governing law and dispute resolution** (Singapore, SIAC arbitration)
10. **Notice that this is a unilateral grant, not a contract**
11. **Severability**
