// 法務正本 (document/v0.1.3/legal/<doc>/<locale>.md) を公開サイト用の HTML + ハッシュに変換し
// web/content/legalDocs.generated.ts を生成する。
//
//   node scripts/gen-legal.mjs   (web/ から)
//
// 方針: 正本 md が唯一の source of truth。生成物を web に同梱することで、Vercel ビルドが
// document/ を読む必要がなくなる(ビルドセーフ)。アプリ側 (app/scripts/gen-legal.mjs) と対。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEGAL_DIR = join(__dirname, '../../document/v0.1.3/legal');
const OUT = join(__dirname, '../content/legalDocs.generated.ts');

const DOCS = ['privacy-policy'];
const LOCALES = ['ja', 'en'];

// 公開レンダリング用クリーニング: 正本 md は内部作業文書なので、本番公開では内部注記だけ除外する
// (実体の条文 §1 要約 + §2 以降は保持)。正本 md 自体は内部閲覧用にそのまま維持 = 単一ソースは保つ。
//   除外対象: メタ行(種別/状態/言語)、§0(層化メカニズム説明)、内部キーワードを含む引用ブロック
//   (= 監査メモ / 公開前に弁護士確認 / Important バナー / 既存公開版への言及 等)。
const INTERNAL_KW = [
  '監査メモ', 'audit memo', 'audit note', '公開前', 'counsel review', 'review by qualified counsel',
  'before publication', 'before publishing', 'important:', '重要:', '既存の公開版',
  'existing published', 'content authenticity', 'privacypolicypage', '叩き台',
  'this draft reflects', 'reflects the decisions',
];
function cleanForPublic(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const hasKw = (t) => { const lo = t.toLowerCase(); return INTERNAL_KW.some((k) => lo.includes(k.toLowerCase())); };
  let h1done = false;
  while (i < lines.length) {
    const line = lines[i];
    // H1 から末尾の (slug) を除去
    if (!h1done && /^#\s+/.test(line)) { out.push(line.replace(/\s*\([^)]*\)\s*$/, '')); h1done = true; i++; continue; }
    // メタ行 (**種別** / **Type** ...)
    if (/^\*\*(種別|Type)\*\*/.test(line.trim())) { i++; continue; }
    // §0 セクション (## 0. ... を次の ## まで)
    if (/^##\s+0[\.\s]/.test(line.trim())) { i++; while (i < lines.length && !/^##\s/.test(lines[i].trim())) i++; continue; }
    // 改訂履歴 (内部変更ログ) は末尾まで丸ごと除外
    if (/^##\s+(改訂履歴|revision\s+history|change\s*log|changelog)/i.test(line.trim())) break;
    // 内部キーワードを含む引用ブロックを除外
    if (line.trim().startsWith('>')) {
      const grp = []; let j = i;
      while (j < lines.length && lines[j].trim().startsWith('>')) { grp.push(lines[j]); j++; }
      if (!hasKw(grp.join(' '))) out.push(...grp);
      i = j; continue;
    }
    out.push(line); i++;
  }
  return out.join('\n');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s) {
  let t = escapeHtml(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  return t;
}

function renderBlocks(lines) {
  const out = [];
  let i = 0;
  const isBlank = (l) => l.trim() === '';

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2].trim())}</h${h[1].length}>`); i++; continue; }

    if (/^-{3,}$/.test(line.trim())) { out.push('<hr/>'); i++; continue; }

    if (line.trim().startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(lines[i].trim()); i++; }
      const cells = (r) => r.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const isSep = (r) => /^\|?[\s:|-]+\|?$/.test(r) && r.includes('-');
      let html = '<table>';
      rows.forEach((r, idx) => {
        if (idx === 1 && isSep(r)) return;
        const tag = idx === 0 ? 'th' : 'td';
        html += '<tr>' + cells(r).map((c) => `<${tag}>${inline(c)}</${tag}>`).join('') + '</tr>';
      });
      html += '</table>';
      out.push(html);
      continue;
    }

    if (line.trim().startsWith('>')) {
      const inner = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) { inner.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push(`<blockquote>${renderBlocks(inner)}</blockquote>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    const para = [];
    while (
      i < lines.length && !isBlank(lines[i]) &&
      !/^(#{1,6})\s/.test(lines[i]) && !lines[i].trim().startsWith('|') &&
      !lines[i].trim().startsWith('>') && !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^-{3,}$/.test(lines[i].trim())
    ) { para.push(lines[i].trim()); i++; }
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('');
}

function mdToHtml(md) { return renderBlocks(md.replace(/\r\n/g, '\n').split('\n')); }
function title(md) { const m = md.match(/^#\s+(.*)$/m); return m ? m[1].replace(/\s*\([^)]*\)\s*$/, '').trim() : ''; }

const result = {};
for (const locale of LOCALES) {
  result[locale] = {};
  for (const doc of DOCS) {
    const md = readFileSync(join(LEGAL_DIR, doc, `${locale}.md`), 'utf8');
    const pub = cleanForPublic(md);
    result[locale][doc] = {
      title: title(md),
      hash: createHash('sha256').update(md, 'utf8').digest('hex'), // 正本 raw の同一性
      html: mdToHtml(pub),
    };
  }
}

const banner =
  '// AUTO-GENERATED by scripts/gen-legal.mjs — DO NOT EDIT.\n' +
  '// Source of truth: document/v0.1.3/legal/<doc>/<locale>.md\n' +
  '// Regenerate: npm run gen:legal\n\n';

const body =
  banner +
  `export type LegalDocKey = ${DOCS.map((d) => `'${d}'`).join(' | ')};\n` +
  "export type LegalLocale = 'ja' | 'en';\n\n" +
  'export interface LegalDocContent { title: string; hash: string; html: string; }\n\n' +
  `export const legalDocs: Record<LegalLocale, Record<LegalDocKey, LegalDocContent>> = ${JSON.stringify(result, null, 2)};\n\n` +
  'export function getLegalDoc(locale: LegalLocale, key: LegalDocKey): LegalDocContent {\n' +
  '  return (legalDocs[locale] ?? legalDocs.ja)[key];\n}\n';

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, body, 'utf8');
console.log(`generated ${OUT} (${LOCALES.length * DOCS.length} docs)`);
