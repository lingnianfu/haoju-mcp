import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES,
  DEFAULT_TIME_ZONE,
  dateIndex,
  getDailyQuote,
  getQuoteByDate,
  getQuoteById,
  getRandomQuote,
  getRecentDates,
  isValidDateString,
  listFacets,
  searchQuotes,
  todayInTimeZone,
  TOTAL,
} from '../dist/index.js';
import { findUnknownTraditional, toSimplified } from '../dist/data/text.js';
import { QUOTES } from '../dist/data/quotes.js';

test('词库规模与基本字段完整性', () => {
  assert.ok(TOTAL >= 200, `词库应至少 200 条，实际 ${TOTAL}`);
  const ids = new Set();
  for (const q of QUOTES) {
    assert.match(q.id, /^q\d{3}$/, `id 格式异常：${q.id}`);
    assert.ok(!ids.has(q.id), `id 重复：${q.id}`);
    ids.add(q.id);
    assert.ok(q.text.trim().length > 0, `${q.id} 正文为空`);
    assert.ok(q.author.trim().length > 0, `${q.id} 作者为空`);
    assert.ok(q.dynasty.trim().length > 0, `${q.id} 朝代为为空`);
    assert.ok(q.source.trim().length > 0, `${q.id} 出处为空`);
    assert.ok(q.categories.length > 0, `${q.id} 缺少主题标签`);
    for (const c of q.categories) {
      assert.ok(CATEGORIES.includes(c), `${q.id} 出现未定义主题：${c}`);
    }
  }
});

test('词库文本不含残留繁体字，且不含空白与引号', () => {
  for (const q of QUOTES) {
    const residual = findUnknownTraditional(q.text + q.author + q.source + q.dynasty);
    assert.deepEqual(residual, [], `${q.id} 残留繁体：${residual.join('')}`);
    assert.ok(!/[\s\u3000]/.test(q.text), `${q.id} 正文含空白`);
    assert.ok(!/[“”"「」]/.test(q.text), `${q.id} 正文含引号`);
  }
});

test('词库正文不重复', () => {
  const seen = new Map();
  for (const q of QUOTES) {
    const key = q.text;
    assert.ok(!seen.has(key), `正文重复：${q.id} 与 ${seen.get(key)}`);
    seen.set(key, q.id);
  }
});

test('日期索引：同日恒定、越界安全、分布不退化', () => {
  assert.equal(dateIndex('2026-10-04'), dateIndex('2026-10-04'));
  assert.ok(dateIndex('2026-10-04') < TOTAL);
  assert.equal(dateIndex('2026-10-04', 0), 0);
  // 连续 60 天不应出现明显的一对一顺序推进（否则就是没有打散）
  const indexes = Array.from({ length: 60 }, (_, i) => dateIndex(`2026-01-${String(i + 1).padStart(2, '0')}`));
  const distinct = new Set(indexes).size;
  assert.ok(distinct > 40, `60 天只落到 ${distinct} 个不同下标，分布过于集中`);
});

test('日期校验：格式与真实性', () => {
  assert.ok(isValidDateString('2026-10-04'));
  assert.ok(isValidDateString('2024-02-29'), '2024 是闰年');
  assert.ok(!isValidDateString('2025-02-29'), '2025 不是闰年');
  assert.ok(!isValidDateString('2026-13-01'));
  assert.ok(!isValidDateString('2026-00-10'));
  assert.ok(!isValidDateString('2026-1-4'));
  assert.ok(!isValidDateString('20261004'));
  assert.throws(() => getQuoteByDate('2026-13-01'), RangeError);
});

test('每日一句：同日期恒定、结构完整', () => {
  const a = getDailyQuote({ now: new Date('2026-10-04T03:00:00Z') });
  const b = getDailyQuote({ now: new Date('2026-10-04T15:00:00Z') });
  // 03:00Z 与 15:00Z 都落在北京时间 10-04
  assert.equal(a.date, '2026-10-04');
  assert.equal(a.id, b.id, '同一天应得到同一条');
  assert.equal(a.total, TOTAL);
  assert.ok(a.dailyIndex >= 1 && a.dailyIndex <= TOTAL);
  assert.equal(getQuoteById(a.id)?.text, a.text);
});

test('每日一句按时区切换（跨零点）', () => {
  // 北京时间 2026-10-05 00:30 == UTC 2026-10-04 16:30 == 纽约 2026-10-04 12:30
  const now = new Date('2026-10-04T16:30:00Z');
  assert.equal(todayInTimeZone('Asia/Shanghai', now), '2026-10-05');
  assert.equal(todayInTimeZone('America/New_York', now), '2026-10-04');
  assert.equal(todayInTimeZone('UTC', now), '2026-10-04');
  assert.equal(getDailyQuote({ timeZone: 'Asia/Shanghai', now }).date, '2026-10-05');
  assert.equal(getDailyQuote({ timeZone: 'America/New_York', now }).date, '2026-10-04');
});

test('默认时区是北京时间', () => {
  assert.equal(DEFAULT_TIME_ZONE, 'Asia/Shanghai');
});

test('按日期取句与最近 N 天', () => {
  const one = getQuoteByDate('2026-10-04');
  assert.equal(one.date, '2026-10-04');
  const recent = getRecentDates(7, { now: new Date('2026-10-04T03:00:00Z') });
  assert.equal(recent.length, 7);
  assert.equal(recent[0].date, '2026-10-04');
  assert.equal(recent[6].date, '2026-09-28');
  // 倒序且日期不重复
  assert.deepEqual([...new Set(recent.map((r) => r.date))].length, 7);
  // 越界参数被夹紧
  assert.equal(getRecentDates(0).length, 1);
  assert.equal(getRecentDates(999).length, 60);
});

test('随机：带 seed 可复现，不带 seed 也在词库内', () => {
  const a = getRandomQuote('hello');
  const b = getRandomQuote('hello');
  assert.equal(a.id, b.id, '同一 seed 应恒定');
  assert.notEqual(getRandomQuote('world').id, a.id);
  const r = getRandomQuote();
  assert.ok(QUOTES.some((q) => q.id === r.id));
});

test('检索：关键词忽略标点、按相关度排序、过滤条件生效', () => {
  const byKeyword = searchQuotes({ keyword: '天生我材' });
  assert.ok(byKeyword.length >= 1, '应命中「天生我材必有用」');
  assert.ok(byKeyword[0].text.includes('天生我材'));

  // 标点无关
  const withPunct = searchQuotes({ keyword: '明月，' });
  const noPunct = searchQuotes({ keyword: '明月' });
  assert.deepEqual(withPunct.map((r) => r.id), noPunct.map((r) => r.id));

  const byAuthor = searchQuotes({ author: '苏轼', limit: 5 });
  assert.ok(byAuthor.length > 0);
  assert.ok(byAuthor.every((r) => r.author.includes('苏轼')));

  const byDynasty = searchQuotes({ dynasty: '先秦', limit: 50 });
  assert.ok(byDynasty.length > 0);
  assert.ok(byDynasty.every((r) => r.dynasty === '先秦'));

  const byCategory = searchQuotes({ categories: ['边塞'], limit: 50 });
  assert.ok(byCategory.length > 0);
  assert.ok(byCategory.every((r) => r.categories.includes('边塞')));

  const byKind = searchQuotes({ sourceKind: '词', limit: 50 });
  assert.ok(byKind.length > 0);
  assert.ok(byKind.every((r) => r.sourceKind === '词'));

  // 组合条件
  const combo = searchQuotes({ dynasty: '唐', categories: ['思乡'], limit: 50 });
  assert.ok(combo.every((r) => r.dynasty === '唐' && r.categories.includes('思乡')));

  // 无匹配
  assert.deepEqual(searchQuotes({ keyword: '这句话一定不存在于词库中' }), []);
});

test('检索：limit 被夹紧在 1..50', () => {
  assert.equal(searchQuotes({ limit: 0 }).length, 1);
  assert.equal(searchQuotes({ limit: -5 }).length, 1);
  assert.equal(searchQuotes({ limit: 999 }).length, 50);
  assert.equal(searchQuotes({ limit: 3 }).length, 3);
});

test('维度列表可用且自洽', () => {
  const facets = listFacets();
  assert.equal(facets.total, TOTAL);
  assert.deepEqual(facets.categories, CATEGORIES);
  assert.ok(facets.dynasties.includes('唐'));
  assert.ok(facets.dynasties.includes('宋'));
  assert.ok(facets.sourceKinds.includes('诗'));
  assert.ok(facets.authors.length > 50);
  // 朝代升序
  assert.deepEqual(facets.dynasties, [...facets.dynasties].sort());
});

test('繁简转换：常见名句转换正确', () => {
  assert.equal(toSimplified('國破山河在，城春草木深。'), '国破山河在，城春草木深。');
  assert.equal(toSimplified('學而時習之，不亦說乎？'), '学而时习之，不亦说乎？');
  assert.equal(toSimplified('先天下之憂而憂，後天下之樂而樂。'), '先天下之忧而忧，后天下之乐而乐。');
  assert.equal(toSimplified('天生我材必有用，千金散盡還復來。'), '天生我材必有用，千金散尽还复来。');
});
