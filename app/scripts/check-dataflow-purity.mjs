#!/usr/bin/env node
// dataflow 層 (Layer 1) の純粋性を機械的に強制する。
//
// app/src/dataflow/** は「React を知らないデータ層」でなければならない。
// react / react-native / zustand(bare の React binding) を import したら fail する。
// 許可: zustand/vanilla (= React 非依存)、 expo-*、 @solana/web3.js、 相対 import、
//       native bridge (= それ自身は react-native を使うが、 dataflow からは関数 export のみ参照)。
//
// このプロジェクトは ESLint 未導入のため、 単一目的の軽量ガードとして実装している。
// 使い方: node scripts/check-dataflow-purity.mjs  (npm run check:dataflow)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DATAFLOW_DIR = join(ROOT, 'src', 'dataflow');

// 禁止する import specifier (= 完全一致)。
const FORBIDDEN = new Set(['react', 'react-native', 'zustand']);

// import ... from 'x' / export ... from 'x' / require('x') / import('x') の specifier を拾う。
const SPECIFIER_RE = /(?:from|require\(|import\()\s*['"]([^'"]+)['"]/g;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const violations = [];
for (const file of walk(DATAFLOW_DIR)) {
  const src = readFileSync(file, 'utf8');
  let m;
  SPECIFIER_RE.lastIndex = 0;
  while ((m = SPECIFIER_RE.exec(src)) !== null) {
    const spec = m[1];
    if (FORBIDDEN.has(spec)) {
      const line = src.slice(0, m.index).split('\n').length;
      violations.push(`${relative(ROOT, file)}:${line}  forbidden import '${spec}'`);
    }
  }
}

if (violations.length > 0) {
  console.error('dataflow purity violation (Layer 1 は react/react-native/zustand を import 不可):');
  for (const v of violations) console.error('  ' + v);
  console.error("\nReact からの購読は UI 層で useStore(dataflowStore, ...) を使い、 store は 'zustand/vanilla' で書くこと。");
  process.exit(1);
}

console.log('dataflow purity OK (react/react-native/zustand の直接 import なし)');
