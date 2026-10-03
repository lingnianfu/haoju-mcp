/** 数据层对外入口。 */
import type { Quote } from './types.js';
import { QUOTES } from './quotes.js';

export { QUOTES };
export * from './types.js';
export * from './text.js';
export {
  getDailyQuote,
  getRandomQuote,
  getQuoteByDate,
  getRecentDates,
  searchQuotes,
  listFacets,
  getQuoteById,
  todayInTimeZone,
  isValidDateString,
  dateIndex,
  DEFAULT_TIME_ZONE,
} from './query.js';

/** 词库总条数。 */
export const TOTAL = QUOTES.length;

/** 在开发与测试里做一致性断言用的最小样本。 */
export function sampleQuotes(count = 3): readonly Quote[] {
  return QUOTES.slice(0, count);
}
