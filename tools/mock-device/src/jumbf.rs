// SPDX-License-Identifier: Apache-2.0
//
// JUMBF (ISO 19566-5) minimal parser.
// Title Protocol crates/core/src/jumbf.rs を mock-device 向けに移植 (Apache-2.0)。
//
// 役割: c2pa::jumbf_io::load_jumbf_from_stream で抽出した JUMBF box ツリーを
//       walk し、 active manifest の c2pa.signature box から COSE 署名 bytes を取り出す。
//       依存は sha2 / hex (上位呼び出し側) のみで c2pa-rs に深くは依存しない。

use anyhow::{anyhow, Result};
use std::io::{Cursor, Read, Seek, SeekFrom};

/// JUMBF box header size (= 4-byte size + 4-byte type).
const HEADER_SIZE: u64 = 8;

/// JUMBF superbox type "jumb" (= 0x6A756D62).
const BOX_TYPE_JUMB: u32 = 0x6A75_6D62;
/// JUMBF description box type "jumd" (= 0x6A756D64).
const BOX_TYPE_JUMD: u32 = 0x6A75_6D64;
/// CBOR content box type "cbor" (= 0x63626F72).
const BOX_TYPE_CBOR: u32 = 0x6362_6F72;

/// c2pa.signature UUID (= 16 bytes、 hex "6332637300110010800000AA00389B71").
const CAI_SIGNATURE_UUID: [u8; 16] = [
    0x63, 0x32, 0x63, 0x73, 0x00, 0x11, 0x00, 0x10, 0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71,
];

/// COSE 署名 CBOR の上限サイズ。 ECDSA 署名 ~70 B、 cert chain 数 KiB / 枚、 OCSP / TSA token 数百 KiB
/// 程度を見込んでマージン込みで 256 KiB。 これを超える入力は DoS として弾く。
const MAX_SIGNATURE_SIZE: u64 = 256 * 1024;

struct BoxHeader {
    box_type: u32,
    size: u64,
}

/// JUMBF box の attacker-controlled `size` を `box_size - HEADER_SIZE` する時のチェック付き減算。
fn content_size(box_size: u64) -> Result<u64> {
    box_size.checked_sub(HEADER_SIZE).ok_or_else(|| {
        anyhow!("JUMBF box size {box_size} smaller than {HEADER_SIZE}-byte header")
    })
}

/// box 終端 offset (= start + size) のオーバーフロー安全版。
fn box_end(box_start: u64, box_size: u64) -> Result<u64> {
    box_start
        .checked_add(box_size)
        .ok_or_else(|| anyhow!("JUMBF box end offset overflow: start={box_start}, size={box_size}"))
}

struct DescInfo {
    uuid: [u8; 16],
    label: String,
}

fn read_header(reader: &mut Cursor<&[u8]>) -> Result<Option<BoxHeader>> {
    let mut buf = [0u8; 8];
    let n = reader.read(&mut buf)?;
    if n == 0 {
        return Ok(None);
    }
    if n < 8 {
        return Err(anyhow!("truncated JUMBF box header"));
    }

    let size = u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]);
    let box_type = u32::from_be_bytes([buf[4], buf[5], buf[6], buf[7]]);

    if size == 1 {
        // Extended size (= 64-bit largesize)
        let mut ext_buf = [0u8; 8];
        reader.read_exact(&mut ext_buf)?;
        Ok(Some(BoxHeader {
            box_type,
            size: u64::from_be_bytes(ext_buf),
        }))
    } else {
        Ok(Some(BoxHeader {
            box_type,
            size: size as u64,
        }))
    }
}

fn read_desc_info(reader: &mut Cursor<&[u8]>, content_size: u64) -> Result<DescInfo> {
    if content_size < 17 {
        return Err(anyhow!("JUMBF description box too short"));
    }

    let mut uuid = [0u8; 16];
    reader.read_exact(&mut uuid)?;

    let mut toggles = [0u8; 1];
    reader.read_exact(&mut toggles)?;

    let mut label = String::new();
    if toggles[0] & 0x02 != 0 {
        let max_label_len = (content_size - 17) as usize;
        let mut byte = [0u8; 1];
        loop {
            if label.len() >= max_label_len {
                return Err(anyhow!("JUMBF label not null-terminated"));
            }
            reader.read_exact(&mut byte)?;
            if byte[0] == 0 {
                break;
            }
            // C2PA label は ASCII (= UUID-like + dotted namespaces)。 非 ASCII は弾く
            if !byte[0].is_ascii() {
                return Err(anyhow!("non-ASCII byte in JUMBF label"));
            }
            label.push(byte[0] as char);
        }
    }

    // ボックス本体内で消費した bytes 数: 16 (uuid) + 1 (toggles) + label bytes (= NUL 含む)
    let label_bytes: u64 = if label.is_empty() {
        0
    } else {
        label.len() as u64 + 1
    };
    let read_so_far: u64 = 16 + 1 + label_bytes;
    if read_so_far < content_size {
        let skip = content_size - read_so_far;
        reader.seek(SeekFrom::Current(skip as i64))?;
    }

    Ok(DescInfo { uuid, label })
}

/// JUMBF データ内の全 manifest label を順に返す。
///
/// 最後の `c2pa.manifest` box が active manifest (= C2PA 2.1 §13.4)。 呼び出し側は `.last()` を取る。
pub fn find_manifest_labels(jumbf_data: &[u8]) -> Result<Vec<String>> {
    let mut reader = Cursor::new(jumbf_data);

    let top_header = read_header(&mut reader)?.ok_or_else(|| anyhow!("empty JUMBF input"))?;
    if top_header.box_type != BOX_TYPE_JUMB {
        return Err(anyhow!("Top-level is not a JUMBF superbox"));
    }

    let desc_header =
        read_header(&mut reader)?.ok_or_else(|| anyhow!("missing top-level description box"))?;
    if desc_header.box_type != BOX_TYPE_JUMD {
        return Err(anyhow!("Description box not found"));
    }
    let _top_desc = read_desc_info(&mut reader, content_size(desc_header.size)?)?;

    let mut labels = Vec::new();
    let top_end = box_end(0, top_header.size)?;

    while reader.position() < top_end {
        let child_start = reader.position();
        let Some(child_header) = read_header(&mut reader)? else {
            break;
        };

        if child_header.box_type == BOX_TYPE_JUMB {
            if let Some(desc_header) = read_header(&mut reader)? {
                if desc_header.box_type == BOX_TYPE_JUMD {
                    let desc = read_desc_info(&mut reader, content_size(desc_header.size)?)?;
                    if !desc.label.is_empty() {
                        labels.push(desc.label);
                    }
                }
            }
        }

        reader.seek(SeekFrom::Start(box_end(child_start, child_header.size)?))?;
    }

    Ok(labels)
}

/// 指定 manifest の `c2pa.signature` box から COSE CBOR bytes を抽出する。
pub fn extract_signature_from_jumbf(jumbf_data: &[u8], manifest_label: &str) -> Result<Vec<u8>> {
    let mut reader = Cursor::new(jumbf_data);

    let top_header = read_header(&mut reader)?.ok_or_else(|| anyhow!("empty JUMBF input"))?;
    if top_header.box_type != BOX_TYPE_JUMB {
        return Err(anyhow!("Top-level is not a JUMBF superbox"));
    }

    let desc_header =
        read_header(&mut reader)?.ok_or_else(|| anyhow!("missing top-level description box"))?;
    if desc_header.box_type != BOX_TYPE_JUMD {
        return Err(anyhow!("Description box not found"));
    }
    let _top_desc = read_desc_info(&mut reader, content_size(desc_header.size)?)?;

    let top_end = box_end(0, top_header.size)?;
    while reader.position() < top_end {
        let child_start = reader.position();
        let Some(child_header) = read_header(&mut reader)? else {
            break;
        };

        if child_header.box_type == BOX_TYPE_JUMB {
            if let Some(desc_header) = read_header(&mut reader)? {
                if desc_header.box_type == BOX_TYPE_JUMD {
                    let desc = read_desc_info(&mut reader, content_size(desc_header.size)?)?;
                    if desc.label == manifest_label {
                        return find_signature_in_manifest(
                            &mut reader,
                            box_end(child_start, child_header.size)?,
                        );
                    }
                }
            }
        }

        reader.seek(SeekFrom::Start(box_end(child_start, child_header.size)?))?;
    }

    Err(anyhow!("Manifest '{manifest_label}' not found in JUMBF"))
}

fn find_signature_in_manifest(reader: &mut Cursor<&[u8]>, manifest_end: u64) -> Result<Vec<u8>> {
    while reader.position() < manifest_end {
        let box_start = reader.position();
        let Some(header) = read_header(reader)? else {
            break;
        };

        if header.box_type == BOX_TYPE_JUMB {
            if let Some(desc_header) = read_header(reader)? {
                if desc_header.box_type == BOX_TYPE_JUMD {
                    let desc = read_desc_info(reader, content_size(desc_header.size)?)?;
                    if desc.uuid == CAI_SIGNATURE_UUID {
                        return find_cbor_in_box(reader, box_end(box_start, header.size)?);
                    }
                }
            }
        }

        reader.seek(SeekFrom::Start(box_end(box_start, header.size)?))?;
    }

    Err(anyhow!("c2pa.signature box not found"))
}

fn find_cbor_in_box(reader: &mut Cursor<&[u8]>, scan_end: u64) -> Result<Vec<u8>> {
    while reader.position() < scan_end {
        let box_start = reader.position();
        let Some(header) = read_header(reader)? else {
            break;
        };

        if header.box_type == BOX_TYPE_CBOR {
            let data_len = content_size(header.size)?;
            if data_len > MAX_SIGNATURE_SIZE {
                return Err(anyhow!(
                    "CBOR box size exceeds limit: {data_len} > {MAX_SIGNATURE_SIZE}"
                ));
            }
            let mut data = vec![0u8; data_len as usize];
            reader.read_exact(&mut data)?;
            return Ok(data);
        }

        reader.seek(SeekFrom::Start(box_end(box_start, header.size)?))?;
    }

    Err(anyhow!("CBOR box not found in c2pa.signature"))
}
