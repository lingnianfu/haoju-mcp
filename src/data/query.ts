/**
 * 查询层：每日一句、随机、检索、按日期。
 *
 * 全部是纯函数：没有 IO、没有随机源以外的外部状态，因此可测试、可复现。
 */
import type { Category, Quote, QuoteResult, SourceKind } from './types.js';
import { CATEGORIES } from './types.js';
import { QUOTES } from './quotes.js';
import { normalizeForCompare } from './text.js';

/** 默认时区。每日一句按北京时间零点切换，保证所有人看到的是同一句。 */
export const DEFAULT_TIME_ZONE = 'Asia/Shanghai';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 判断是否为合法的 YYYY-MM-DD，并且是真实存在的日期。 */
export function isValidDateString(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  if (m < 1 || m > 12) return false;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d >= 1 && d <= daysInMonth;
}

/** 取指定时区里的「今天」，格式 YYYY-MM-DD。 */
export function todayInTimeZone(timeZone: string = DEFAULT_TIME_ZONE, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  // en-CA 输出形如 2026-10-04，直接可用
  return parts;
}

/**
 * FNV-1a 32 位哈希。用它把日期映射成词库下标。
 *
 * 选 FNV-1a 是因为实现短、无依赖、分布足够均匀：相邻日期（只差最后一位）
 * 也能落到相距较远的位置，不会出现「今天和明天是相邻两条」的机械感。
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * 把日期映射为词库下标。
 *
 * 同一日期恒定得到同一条（这是「每日一句」的核心保证），
 * 不同日期的分布由 FNV-1a 打散。
 */
export function dateIndex(date: string, total: number = QUOTES.length): number {
  if (total <= 0) return 0;
  return fnv1a(date) % total;
}

function toResult(quote: Quote, date: string): QuoteResult {
  const index = QUOTES.indexOf(quote);
  return {
    ...quote,
    date,
    dailyIndex: index + 1,
    total: QUOTES.length,
  };
}

function requireQuote(index: number): Quote {
  const quote = QUOTES[index];
  if (!quote) throw new Error('词库为空，无法取句');
  return quote;
}

/** 按日期取当日佳句。日期格式 YYYY-MM-DD。 */
export function getQuoteByDate(date: string): QuoteResult {
  if (!isValidDateString(date)) {
    throw new RangeError(`日期格式应为 YYYY-MM-DD 且必须是真实存在的日期，收到：${date}`);
  }
  return toResult(requireQuote(dateIndex(date)), date);
}

/** 取今天的佳句（默认按北京时间判断「今天」）。 */
export function getDailyQuote(options: { timeZone?: string; now?: Date } = {}): QuoteResult {
  const date = todayInTimeZone(options.timeZone ?? DEFAULT_TIME_ZONE, options.now ?? new Date());
  return getQuoteByDate(date);
}

/**
 * 取随机佳句。
 *
 * 传入 seed 时结果可复现（同一 seed 恒定同一条），便于测试与「分享同一句」；
 * 不传 seed 时使用 Math.random。
 */
export function getRandomQuote(seed?: string | number): QuoteResult {
  const today = todayInTimeZone();
  if (seed !== undefined && seed !== '') {
    return toResult(requireQuote(fnv1a(`seed:${seed}`) % QUOTES.length), today);
  }
  return toResult(requireQuote(Math.floor(Math.random() * QUOTES.length)), today);
}

/** 取最近若干天的每日一句（含今天），按日期倒序。 */
export function getRecentDates(days = 7, options: { timeZone?: string; now?: Date } = {}): QuoteResult[] {
  const count = Math.min(Math.max(Math.trunc(days) || 1, 1), 60);
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const base = options.now ?? new Date();
  return Array.from({ length: count }, (_, offset) => {
    const day = new Date(base.getTime() - offset * 24 * 60 * 60 * 1000);
    return getQuoteByDate(todayInTimeZone(timeZone, day));
  });
}

/** 检索条件。所有条件同时满足才命中（AND 语义）。 */
export interface SearchOptions {
  /** 关键词：在正文、作者、出处上做包含匹配。 */
  keyword?: string;
  /** 主题标签，命中任意一个即可。 */
  categories?: readonly Category[];
  /** 作者名，包含匹配。 */
  author?: string;
  /** 朝代，精确匹配。 */
  dynasty?: string;
  /** 体裁，精确匹配。 */
  sourceKind?: SourceKind;
  /** 最多返回条数，默认 10，上限 50。 */
  limit?: number;
}

/** 关键词在一条词句里的命中位置权重：正文优先于作者，作者优先于出处。 */
function scoreOf(quote: Quote, keyword: string): number {
  if (!keyword) return 1;
  const needle = normalizeForCompare(keyword);
  if (!needle) return 1;
  const text = normalizeForCompare(quote.text);
  const author = normalizeForCompare(quote.author);
  const source = normalizeForCompare(quote.source);
  let score = 0;
  if (text.includes(needle)) score += 10;
  if (author.includes(needle)) score += 4;
  if (source.includes(needle)) score += 2;
  if (normalizeForCompare(quote.categories.join('')).includes(needle)) score += 1;
  return score;
}

/**
 * 检索词句。
 *
 * 关键词做「去标点后再包含」匹配，因此「天生我材」能命中
 * 「天生我材必有用，千金散尽还复来。」；作者与出处同样参与匹配。
 */
export function searchQuotes(options: SearchOptions = {}): QuoteResult[] {
  // 注意不能用 `options.limit || 10`：limit 为 0 时会被误判为「未传」而变成 10。
  const rawLimit = options.limit === undefined ? 10 : Math.trunc(options.limit);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 10, 1), 50);
  const keyword = options.keyword?.trim() ?? '';
  const author = options.author?.trim() ?? '';
  const categories = options.categories ?? [];
  const today = todayInTimeZone();

  const scored = QUOTES.map((quote, index) => ({ quote, index, score: scoreOf(quote, keyword) }))
    .filter(({ quote, score }) => {
      if (keyword && score === 0) return false;
      if (author && !quote.author.includes(author)) return false;
      if (options.dynasty && quote.dynasty !== options.dynasty) return false;
      if (options.sourceKind && quote.sourceKind !== options.sourceKind) return false;
      if (categories.length > 0 && !categories.some((c) => quote.categories.includes(c))) return false;
      return true;
    })
    // 有分数时按分数降序，同分保持词库原序（稳定、可复现）
    .sort((a, b) => (keyword ? b.score - a.score || a.index - b.index : a.index - b.index))
    .slice(0, limit);

  return scored.map(({ quote }) => toResult(quote, today));
}

/** 词库的可用维度：主题、朝代、体裁，以及可选作者列表。 */
export function listFacets(): {
  categories: readonly Category[];
  dynasties: string[];
  sourceKinds: SourceKind[];
  authors: string[];
  total: number;
} {
  const dynasties = new Set<string>();
  const sourceKinds = new Set<SourceKind>();
  const authors = new Set<string>();
  for (const quote of QUOTES) {
    dynasties.add(quote.dynasty);
    sourceKinds.add(quote.sourceKind);
    authors.add(quote.author);
  }
  return {
    categories: CATEGORIES,
    dynasties: [...dynasties].sort(),
    sourceKinds: [...sourceKinds],
    authors: [...authors].sort(),
    total: QUOTES.length,
  };
}

/** 按 id 精确取一条。 */
export function getQuoteById(id: string): QuoteResult | undefined {
  const quote = QUOTES.find((q) => q.id === id);
  return quote ? toResult(quote, todayInTimeZone()) : undefined;
}
