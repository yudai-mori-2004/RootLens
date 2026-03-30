// SPDX-License-Identifier: Apache-2.0

//! Jarosz downsampling WASM module for browser-side PDQ hash computation.
//!
//! This is a `no_std` WASM wrapper around the Jarosz filter algorithm from
//! Title Protocol's `wasm-host/src/jarosz.rs`. The core algorithm is identical;
//! only the memory management is adapted for `wasm32-unknown-unknown`.
//!
//! # Source
//!
//! Copied from: title-protocol/crates/wasm-host/src/jarosz.rs
//! Original C++ source: Meta ThreatExchange PDQ (BSD license)
//! See: https://github.com/facebook/ThreatExchange/blob/main/pdq/cpp/downscaling/downscaling.cpp

#![no_std]

extern crate alloc;

use alloc::vec;
use alloc::vec::Vec;

#[global_allocator]
static ALLOC: dlmalloc::GlobalDlmalloc = dlmalloc::GlobalDlmalloc;

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

// ---------------------------------------------------------------------------
// WASM exports
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn alloc_mem(size: u32) -> u32 {
    let layout = core::alloc::Layout::from_size_align(size as usize, 1).unwrap();
    unsafe { alloc::alloc::alloc(layout) as u32 }
}

/// Downsample RGBA pixel data to 64x64 grayscale using Jarosz filter.
///
/// # Arguments (via WASM linear memory)
/// * `rgba_ptr` - pointer to RGBA pixel data
/// * `width` - image width in pixels
/// * `height` - image height in pixels
/// * `output_ptr` - pointer to output buffer (must be >= 64*64 = 4096 bytes)
///
/// # Returns
/// Output length (4096) on success, 0 on error.
#[no_mangle]
pub extern "C" fn downsample_rgba_64x64(
    rgba_ptr: u32,
    width: u32,
    height: u32,
    output_ptr: u32,
) -> u32 {
    let w = width as usize;
    let h = height as usize;
    let rgba = unsafe { core::slice::from_raw_parts(rgba_ptr as *const u8, w * h * 4) };
    let result = downsample_from_decoded(rgba, width, height, 4, 64, 64);
    let output = unsafe { core::slice::from_raw_parts_mut(output_ptr as *mut u8, 64 * 64) };
    output.copy_from_slice(&result);
    (64 * 64) as u32
}

// ---------------------------------------------------------------------------
// Jarosz algorithm (copied from title-protocol/crates/wasm-host/src/jarosz.rs)
// ---------------------------------------------------------------------------

fn compute_window_size(old_dim: u32, new_dim: u32) -> usize {
    ((old_dim as usize) + 2 * (new_dim as usize) - 1) / (2 * new_dim as usize)
}

fn box_1d_float(
    invec: &[f32],
    outvec: &mut [f32],
    vector_length: usize,
    stride: usize,
    full_window_size: usize,
) {
    let half_window_size = (full_window_size + 2) / 2;

    let phase_1_nreps = half_window_size - 1;
    let phase_2_nreps = full_window_size - half_window_size + 1;
    let phase_3_nreps = if vector_length > full_window_size {
        vector_length - full_window_size
    } else {
        0
    };
    let phase_4_nreps = half_window_size - 1;

    let mut li = 0usize;
    let mut ri = 0usize;
    let mut oi = 0usize;
    let mut sum = 0.0f32;
    let mut current_window_size = 0usize;

    for _ in 0..phase_1_nreps {
        sum += invec[ri];
        current_window_size += 1;
        ri += stride;
    }

    for _ in 0..phase_2_nreps {
        sum += invec[ri];
        current_window_size += 1;
        outvec[oi] = sum / current_window_size as f32;
        ri += stride;
        oi += stride;
    }

    for _ in 0..phase_3_nreps {
        sum += invec[ri];
        sum -= invec[li];
        outvec[oi] = sum / current_window_size as f32;
        li += stride;
        ri += stride;
        oi += stride;
    }

    for _ in 0..phase_4_nreps {
        sum -= invec[li];
        current_window_size -= 1;
        outvec[oi] = sum / current_window_size as f32;
        li += stride;
        oi += stride;
    }
}

fn box_along_rows(
    input: &[f32],
    output: &mut [f32],
    num_rows: usize,
    num_cols: usize,
    window_size: usize,
) {
    for i in 0..num_rows {
        let offset = i * num_cols;
        box_1d_float(
            &input[offset..],
            &mut output[offset..],
            num_cols,
            1,
            window_size,
        );
    }
}

fn box_along_cols(
    input: &[f32],
    output: &mut [f32],
    num_rows: usize,
    num_cols: usize,
    window_size: usize,
) {
    for j in 0..num_cols {
        box_1d_float(&input[j..], &mut output[j..], num_rows, num_cols, window_size);
    }
}

fn jarosz_filter(
    buffer1: &mut [f32],
    buffer2: &mut [f32],
    num_rows: usize,
    num_cols: usize,
    window_along_rows: usize,
    window_along_cols: usize,
    nreps: usize,
) {
    for _ in 0..nreps {
        box_along_rows(buffer1, buffer2, num_rows, num_cols, window_along_rows);
        box_along_cols(buffer2, buffer1, num_rows, num_cols, window_along_cols);
    }
}

fn decimate(
    input: &[f32],
    in_rows: usize,
    in_cols: usize,
    output: &mut [f32],
    out_rows: usize,
    out_cols: usize,
) {
    for outi in 0..out_rows {
        let ini = ((outi as f64 + 0.5) * in_rows as f64 / out_rows as f64) as usize;
        for outj in 0..out_cols {
            let inj = ((outj as f64 + 0.5) * in_cols as f64 / out_cols as f64) as usize;
            output[outi * out_cols + outj] = input[ini * in_cols + inj];
        }
    }
}

fn downsample_from_decoded(
    data: &[u8],
    width: u32,
    height: u32,
    channels: u32,
    target_w: u32,
    target_h: u32,
) -> Vec<u8> {
    let w = width as usize;
    let h = height as usize;
    let tw = target_w as usize;
    let th = target_h as usize;
    let ch = channels as usize;

    // Convert to f32 luminance (BT.601: Y = 0.299R + 0.587G + 0.114B)
    let mut buffer1 = vec![0.0f32; w * h];
    match ch {
        1 => {
            for i in 0..w * h {
                buffer1[i] = data[i] as f32;
            }
        }
        3 => {
            for i in 0..w * h {
                let r = data[i * 3] as f32;
                let g = data[i * 3 + 1] as f32;
                let b = data[i * 3 + 2] as f32;
                buffer1[i] = 0.299 * r + 0.587 * g + 0.114 * b;
            }
        }
        4 => {
            for i in 0..w * h {
                let r = data[i * 4] as f32;
                let g = data[i * 4 + 1] as f32;
                let b = data[i * 4 + 2] as f32;
                buffer1[i] = 0.299 * r + 0.587 * g + 0.114 * b;
            }
        }
        _ => {
            for i in 0..w * h {
                buffer1[i] = data[i * ch] as f32;
            }
        }
    }

    if w == tw && h == th {
        return buffer1
            .iter()
            .map(|&v| {
                let r = if v >= 0.0 { v + 0.5 } else { v - 0.5 } as i32;
                r.max(0).min(255) as u8
            })
            .collect();
    }

    let mut buffer2 = vec![0.0f32; w * h];
    let window_along_rows = compute_window_size(width, target_w);
    let window_along_cols = compute_window_size(height, target_h);
    const NUM_JAROSZ_XY_PASSES: usize = 2;

    jarosz_filter(
        &mut buffer1,
        &mut buffer2,
        h,
        w,
        window_along_rows,
        window_along_cols,
        NUM_JAROSZ_XY_PASSES,
    );

    let mut output_f32 = vec![0.0f32; tw * th];
    decimate(&buffer1, h, w, &mut output_f32, th, tw);

    output_f32
        .iter()
        .map(|&v| {
            let r = if v >= 0.0 { v + 0.5 } else { v - 0.5 } as i32;
            r.max(0).min(255) as u8
        })
        .collect()
}
