#!/usr/bin/env node
// Generate first-person editorial illustrations for sandbox-04 task briefs.
// Calls Gemini's image generation model (gemini-2.5-flash-image / "Nano Banana").
//
// Usage:
//   EXPO_PUBLIC_GEMINI_API_KEY=... node pipeline/asset-gen/generate-task-illustrations.mjs
//
// Output: app/assets/sandbox-04/tasks/<id>/{start,end}.png

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../..');
const OUT_DIR = join(REPO, 'app/assets/sandbox-04/tasks');

// Load .env if EXPO_PUBLIC_GEMINI_API_KEY not in env.
async function loadEnvKey() {
  if (process.env.EXPO_PUBLIC_GEMINI_API_KEY) return process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  try {
    const text = await readFile(join(REPO, 'app/.env'), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^EXPO_PUBLIC_GEMINI_API_KEY=(.+)$/);
      if (m) return m[1].trim();
    }
  } catch {/* ignore */}
  throw new Error('EXPO_PUBLIC_GEMINI_API_KEY not set');
}

const STYLE = (
  'Editorial first-person photograph, soft natural daylight, warm muted palette (warm whites, ' +
  'oak wood, soft greys), shallow depth of field, photographic realism, no text, 16:9 horizontal aspect ratio.'
);

const TASKS = [
  {
    id: 'fold-laundry',
    start: `First-person view of a person sitting on a sofa or wood floor, about to fold laundry. ` +
      `In the center of the frame: a single pile of clean unfolded laundry (t-shirts, towels) gathered together. ` +
      `Both hands visible at the bottom edge of the frame, palms open, ready to start folding. ${STYLE}`,
    end: `First-person view looking down at neatly folded laundry on a wood floor or sofa. ` +
      `Four to five folded items (t-shirts, towels) arranged in a tidy row, each item crisply folded. ` +
      `No hands in the frame. ${STYLE}`,
  },
  {
    id: 'wash-dishes',
    start: `First-person view from a person standing at a kitchen sink. ` +
      `Dirty dishes — plates, mugs, utensils — stacked in the sink, with visible food residue. ` +
      `A faucet visible at the top. Both hands visible at the bottom edge of the frame near the dishes. ${STYLE}`,
    end: `First-person view of a kitchen drying rack with washed dishes — clean plates standing on edge, ` +
      `mugs and utensils placed neatly. The sink behind it is empty and wet but clean. No hands in the frame. ${STYLE}`,
  },
  {
    id: 'cook-pasta',
    start: `First-person view of a kitchen counter from above. Laid out: a box of dry pasta, a jar of tomato sauce, ` +
      `a clean stainless pan, a wooden spoon, a small bowl of salt. ` +
      `Both hands visible at the bottom edge of the frame, hovering above the ingredients. ${STYLE}`,
    end: `First-person view looking down at a single white plate of cooked pasta with rich tomato sauce, ` +
      `garnished with a sprinkle of herbs, on a wood kitchen counter. No hands in the frame. ${STYLE}`,
  },
  {
    id: 'vacuum-floor',
    start: `First-person view of a living room hardwood floor with visible dust, breadcrumbs, and small bits ` +
      `of debris scattered. The right hand grips a vacuum cleaner handle in the lower right of the frame; ` +
      `the left hand is also visible at the bottom edge. ${STYLE}`,
    end: `First-person view of a perfectly clean living room hardwood floor — no dust, no debris, ` +
      `gleaming softly under natural light. No hands in the frame. ${STYLE}`,
  },
  {
    id: 'make-bed',
    start: `First-person view from a person standing at the foot of a bed. Sheets are messy and rumpled, ` +
      `the blanket is half off, two pillows lie disheveled at odd angles. ` +
      `Both hands visible at the bottom edge of the frame. Soft morning light. ${STYLE}`,
    end: `First-person view from a person standing at the foot of a freshly made bed: sheets pulled tight, ` +
      `blanket folded crisply across the foot of the bed, two pillows arranged neatly at the head. ` +
      `No hands in the frame. Soft morning light. ${STYLE}`,
  },
];

const MODEL = 'gemini-2.5-flash-image';

async function generate(prompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'] },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  }
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  const imgPart = parts.find((p) => p?.inlineData?.data);
  if (!imgPart) {
    throw new Error(`no image in response: ${JSON.stringify(json).slice(0, 400)}`);
  }
  return Buffer.from(imgPart.inlineData.data, 'base64');
}

async function saveImage(path, buf) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buf);
}

async function main() {
  const key = await loadEnvKey();
  console.log(`[*] Using model: ${MODEL}`);
  console.log(`[*] Writing to: ${OUT_DIR}`);

  for (const task of TASKS) {
    for (const phase of ['start', 'end']) {
      const out = join(OUT_DIR, task.id, `${phase}.png`);
      console.log(`[+] ${task.id}/${phase}.png ...`);
      try {
        const buf = await generate(task[phase], key);
        await saveImage(out, buf);
        console.log(`    ${(buf.length / 1024).toFixed(0)} KB`);
      } catch (err) {
        console.error(`    FAILED: ${err.message}`);
      }
    }
  }
  console.log('\n[*] Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
