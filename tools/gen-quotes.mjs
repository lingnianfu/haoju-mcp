// 词库生成器：把 data-source 下的权威语料 + 选择表，编译成 src/data/quotes.ts。
//
// 设计要点：诗句原文一律按索引/定位从语料抽取，绝不手抄；转换后再用
// findUnknownTraditional 自检一次，确保对外文本里不残留未转换的繁体字。
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toSimplified, findUnknownTraditional, normalizeForCompare } from '../dist/data/text.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'data-source');
const RAW = join(SRC, 'raw');

const load = async (rel) => JSON.parse(await readFile(join(SRC, rel), 'utf8'));
const loadRaw = async (name) => JSON.parse(await readFile(join(RAW, name), 'utf8'));

const selections = await load('selections.json');
const classics = await load('classics.json');

const tangshi = await loadRaw('tangshi300.json');
const songci = await loadRaw('songci300.json');
const shijing = await loadRaw('shijing.json');
const chuci = await loadRaw('chuci.json');
const lunyu = await loadRaw('lunyu.json');
const daxue = await loadRaw('daxue.json');
const zhongyong = await loadRaw('zhongyong.json');
const mengzi = await loadRaw('mengzi.json');
const youmengying = await loadRaw('youmengying.json');
const guwen = await loadRaw('guwenguanzhi.json');
const zengguang = await loadRaw('zengguangxianwen.json');
const qianjiashi = await loadRaw('qianjiashi.json');

const problems = [];
const quotes = [];
const seen = new Map();

/** 繁简转换 + 去空白与引号，并消除剥掉引号后残留的孤立括号（如「宋）」）。 */
function tidy(input) {
  return toSimplified(String(input))
    .replace(/[\u3000\s]+/g, '')
    .replace(/[“”"「」『』]/g, '')
    // 剥掉引号后可能两头都留下括号：「（宋）孟浩然」被去掉引号不会，但「（宋）」会
    .replace(/^[）】」』]+/, '')
    .replace(/[）】」』]+$/, '')
    .replace(/[（【「『]+$/, '')
    .replace(/^[（【「『]+/, '')
    .trim();
}
const cleanText = tidy;
const cleanLabel = tidy;

/** 组装一条词句；text 会统一做繁简转换与空白清理。 */
function addQuote({ text, author, dynasty, source, sourceKind, categories, note }) {
  const clean = cleanText(toSimplified(String(text)));
  if (!clean) {
    problems.push(`空文本：${source} / ${author}`);
    return;
  }
  const leftover = findUnknownTraditional(clean);
  if (leftover.length > 0) {
    problems.push(`残留繁体 ${leftover.join('')}：${clean.slice(0, 30)}（${source}）`);
  }
  const key = normalizeForCompare(clean);
  if (seen.has(key)) {
    // 同一段被选择表重复指定时属于配置冗余，无需报警；只有不同篇目撞同一文本才值得报
    const prev = seen.get(key);
    if (prev !== `${source}/${author}`) {
      problems.push(`重复词句：${clean.slice(0, 24)}（已在 ${prev}）`);
    }
    return;
  }
  seen.set(key, `${source}/${author}`);
  quotes.push({
    id: `q${String(quotes.length + 1).padStart(3, '0')}`,
    text: clean,
    author: cleanLabel(author),
    dynasty: toSimplified(dynasty).trim(),
    source: cleanLabel(source),
    sourceKind,
    categories,
    ...(note ? { note: toSimplified(note) } : {}),
  });
}

/** 段落定位统一在「简体化之后」的文本上做，避免源文是繁体时搜不到简体关键词。 */
const toSimp = (s) => toSimplified(String(s));
const hasFind = (text, find) => toSimp(text).includes(toSimp(find));

/**
 * 从 startIndex 开始按句延伸，直到内容够完整为止（至少 12 字，或到篇末）。
 * 用于词这类分句很碎的体裁，避免抽出一句「谁怕。」这样的残句。
 */
function extendLines(paragraphs, startIndex) {
  const out = [];
  for (let i = startIndex; i < paragraphs.length; i += 1) {
    const line = paragraphs[i];
    if (typeof line !== 'string') break;
    out.push(line);
    if (out.join('').length >= 12) break;
  }
  return out;
}

/** 按 pick 描述从段落数组里取出选中的句子。 */
function pickParagraphs(paragraphs, pick, label) {
  if (Array.isArray(pick)) {
    return pick
      .map((idx) => {
        const p = paragraphs[idx];
        if (p === undefined) problems.push(`${label}: 段落索引 ${idx} 越界（共 ${paragraphs.length} 段）`);
        return p;
      })
      .filter((p) => typeof p === 'string');
  }
  // 整篇拼接后再找，避免「名句跨段」时定位失败
  const whole = paragraphs.join('');
  if (!hasFind(whole, pick.contains)) {
    problems.push(`${label}: 未找到含「${pick.contains}」的段落`);
    return [];
  }
  const hit = paragraphs.find((p) => hasFind(p, pick.contains));
  return hit ? [hit] : [whole];
}

// ── 1) 唐诗三百首 ─────────────────────────────────────
for (const sel of selections.tang) {
  const poem = tangshi[sel.i];
  if (!poem) {
    problems.push(`tang #${sel.i} 不存在`);
    continue;
  }
  const label = `tang #${sel.i} ${poem.author}《${poem.title}》`;
  const picked = pickParagraphs(poem.paragraphs, sel.pick, label);
  if (picked.length === 0) continue;
  addQuote({
    text: picked.join(''),
    author: poem.author,
    dynasty: '唐',
    source: poem.title,
    sourceKind: '诗',
    categories: sel.cats,
  });
}

// ── 2) 宋词三百首 ─────────────────────────────────────
for (const sel of selections.song) {
  const ci = songci[sel.i];
  if (!ci) {
    problems.push(`song #${sel.i} 不存在`);
    continue;
  }
  const label = `song #${sel.i} ${ci.author}《${ci.rhythmic}》`;
  // 词的分句很短（「谁怕。」「不思量。」），单取一句会显得残缺。
  // 因此这里按句延伸：至少凑到 12 字，尽量形成完整的一韵。
  const picked = Array.isArray(sel.pick) && sel.pick.length === 1
    ? extendLines(ci.paragraphs, sel.pick[0])
    : pickParagraphs(ci.paragraphs, sel.pick, label);
  if (picked.length === 0) continue;
  addQuote({
    text: picked.join(''),
    author: ci.author,
    dynasty: '宋',
    source: ci.rhythmic,
    sourceKind: '词',
    categories: sel.cats,
  });
}

// ── 3) 诗经 ───────────────────────────────────────
for (const sel of classics.shijing) {
  const poem = shijing.find((p) => p.content.some((line) => hasFind(line, sel.find)));
  if (!poem) {
    problems.push(`shijing 未找到「${sel.find}」`);
    continue;
  }
  const line = poem.content.find((l) => hasFind(l, sel.find));
  addQuote({
    text: line,
    author: '佚名',
    dynasty: '先秦',
    source: `${poem.title}（诗经·${poem.chapter}）`,
    sourceKind: '诗',
    categories: sel.cats,
  });
}

// ── 4) 楚辞 ───────────────────────────────────────
for (const sel of classics.chuci) {
  const hit = chuci.find((p) => p.content.some((line) => hasFind(line, sel.find)));
  if (!hit) {
    problems.push(`chuci 未找到「${sel.find}」`);
    continue;
  }
  const line = hit.content.find((l) => hasFind(l, sel.find));
  addQuote({
    text: line,
    author: hit.author,
    dynasty: '先秦',
    source: `${hit.title}（楚辞）`,
    sourceKind: '辞',
    categories: sel.cats,
  });
}

// ── 5) 论语 / 大学 / 中庸 / 孟子 ───────────────────────
function fromClassic(book, items, dynasty, source, sourceKind, author) {
  const chapters = Array.isArray(book) ? book : [book];
  for (const sel of items) {
    const chapterHit = chapters.find((c) => c.paragraphs.some((p) => hasFind(p, sel.find)));
    const para = chapterHit?.paragraphs.find((p) => hasFind(p, sel.find));
    if (!chapterHit || !para) {
      problems.push(`${source} 未找到「${sel.find}」`);
      continue;
    }
    addQuote({
      text: para,
      author,
      dynasty,
      source: chapterHit.chapter ? `${source}·${chapterHit.chapter}` : source,
      sourceKind,
      categories: sel.cats,
    });
  }
}

fromClassic(lunyu, classics.lunyu, '先秦', '论语', '子', '孔子及其弟子');
fromClassic(daxue, classics.daxue, '先秦', '大学', '子', '曾子');
fromClassic(zhongyong, classics.zhongyong, '先秦', '中庸', '子', '子思');
fromClassic(mengzi, classics.mengzi, '先秦', '孟子', '子', '孟子及其弟子');

// ── 6) 道德经（Project Gutenberg 公共领域文本） ──────────
const ddjText = await readFile(join(SRC, 'probe-ddj.txt'), 'utf8');
const ddjChapters = new Map();
{
  const start = ddjText.indexOf('老子道經');
  const bodyText = start >= 0 ? ddjText.slice(start) : ddjText;
  let current = null;
  for (const rawLine of bodyText.split(/\r?\n/)) {
    const marker = rawLine.trim().match(/^第([一二三四五六七八九十百]+)章$/);
    if (marker) {
      current = marker[1];
      ddjChapters.set(current, []);
      continue;
    }
    if (current === null) continue;
    const line = rawLine.replace(/\s+/g, '').replace(/﹔/g, '；');
    if (line) ddjChapters.get(current).push(line);
  }
}
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
function cnNum(n) {
  if (n <= 10) return CN_NUM[n - 1];
  if (n < 20) return `十${CN_NUM[n - 11]}`;
  if (n === 20) return '二十';
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${CN_NUM[tens - 1]}十${ones ? CN_NUM[ones - 1] : ''}`;
}
for (const sel of classics.dao) {
  const key = cnNum(sel.chapter);
  const lines = ddjChapters.get(key);
  if (!lines || lines.length === 0) {
    problems.push(`道德经 第${key}章 未解析到内容`);
    continue;
  }
  const text = lines.join('').replace(/[「」]/g, '');
  // 整章可能很长，只取开头两句话并限制长度，符合「好词好句」的粒度
  const sentences = text.split(/(?<=[。！？])/).filter(Boolean);
  const cut = sentences.slice(0, 2).join('').slice(0, 60);
  addQuote({
    text: cut,
    author: '老子',
    dynasty: '先秦',
    source: `道德经·第${sel.chapter}章`,
    sourceKind: '子',
    categories: sel.cats,
  });
}

// ── 7) 幽梦影 ──────────────────────────────────────
for (const sel of classics.youmengying) {
  const hit = youmengying.find((item) => hasFind(item.content, sel.find));
  if (!hit) {
    problems.push(`youmengying 未找到「${sel.find}」`);
    continue;
  }
  addQuote({
    text: hit.content,
    author: '张潮',
    dynasty: '清',
    source: '幽梦影',
    sourceKind: '子',
    categories: sel.cats,
  });
}

// ── 8) 增广贤文 ────────────────────────────────────
for (const sel of classics.zengguang) {
  const hit = zengguang.content
    .flatMap((chapter) => chapter.paragraphs)
    .find((p) => hasFind(p, sel.find));
  if (!hit) {
    problems.push(`zengguang 未找到「${sel.find}」`);
    continue;
  }
  addQuote({
    text: hit,
    author: '佚名',
    dynasty: '明',
    source: '增广贤文',
    sourceKind: '文',
    categories: sel.cats,
  });
}

// ── 9) 千家诗 ──────────────────────────────────────
// 结构有两层：type → content → {chapter, author, paragraphs}，
// 少数篇目还有 subchapter 再嵌一层，因此这里递归收集「带 paragraphs 的叶子」。
const qianjiaPoems = [];
(function collectPoems(node) {
  if (Array.isArray(node)) {
    for (const item of node) collectPoems(item);
    return;
  }
  if (node && typeof node === 'object') {
    if (typeof node.chapter === 'string' && Array.isArray(node.paragraphs)) {
      qianjiaPoems.push(node);
    }
    for (const value of Object.values(node)) collectPoems(value);
  }
})(qianjiashi);

for (const sel of classics.qianjiashi) {
  const found = qianjiaPoems
    .map((poem) => ({ poem, line: poem.paragraphs.find((p) => typeof p === 'string' && hasFind(p, sel.find)) }))
    .find((x) => x.line);
  if (!found) {
    problems.push(`qianjiashi 未找到「${sel.find}」`);
    continue;
  }
  // 朝代写在原始作者串的括号里（如「（唐）孟浩然」）。
  // 必须在这里先提取：addQuote 内部的 tidy 会把括号一并清掉，之后再也取不到。
  const rawAuthor = String(found.poem.author);
  const dynasty = rawAuthor.match(/^[（(]([^）)]*)[）)]/)?.[1] ?? '';
  const author = rawAuthor.replace(/^[（(][^）)]*[）)]\s*/, '');
  addQuote({
    text: found.line,
    author,
    dynasty,
    source: found.poem.chapter,
    sourceKind: '诗',
    categories: sel.cats,
  });
}

// ── 报告与输出 ─────────────────────────────────────
console.log(`生成词句：${quotes.length} 条`);
const byKind = {};
const byCat = {};
for (const q of quotes) {
  byKind[q.sourceKind] = (byKind[q.sourceKind] ?? 0) + 1;
  for (const c of q.categories) byCat[c] = (byCat[c] ?? 0) + 1;
}
console.log('按体裁：', Object.entries(byKind).map(([k, v]) => `${k}${v}`).join(' '));
console.log('按主题：', Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}${v}`).join(' '));

if (problems.length > 0) {
  console.log(`\n⚠️ ${problems.length} 个问题：`);
  for (const p of problems) console.log('  - ' + p);
  process.exitCode = 1;
}

// 输出为 TS 字面量：既避免 JSON import assertion 的兼容性问题，也让 tsc 做类型检查
const header = `/**
 * 词库数据。此文件由 tools/gen-quotes.mjs 生成，请勿手工编辑。
 *
 * 生成来源：
 *   - 唐诗三百首 / 宋词三百首 / 诗经 / 楚辞 / 论语 / 大学 / 中庸 / 孟子 / 幽梦影 /
 *     增广贤文 / 千家诗：chinese-poetry/chinese-poetry
 *   - 道德经：Project Gutenberg eBook #7337（公共领域）
 * 诗句原文按索引从语料抽取，并经繁简转换与残留自检，不含手工转录。
 *
 * 重新生成：npm run gen（需要 data-source/ 下的语料缓存）
 */
import type { Quote } from './types.js';

export const QUOTES: readonly Quote[] = `;

await writeFile(
  join(ROOT, 'src', 'data', 'quotes.ts'),
  `${header}${JSON.stringify(quotes, null, 1)} as const;\n`,
  'utf8',
);
console.log('已写入 src/data/quotes.ts');
void guwen;
