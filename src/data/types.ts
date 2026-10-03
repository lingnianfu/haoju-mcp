/** 词句数据的类型定义。 */

/** 体裁：诗 / 词 / 辞 / 赋 / 文 / 子（诸子与蒙学格言）。 */
export type SourceKind = '诗' | '词' | '辞' | '赋' | '文' | '子';

/** 主题标签。对外暴露的就是这一组，保证检索维度稳定。 */
export type Category =
  | '山水'
  | '田园'
  | '边塞'
  | '战争'
  | '思乡'
  | '送别'
  | '爱情'
  | '友情'
  | '咏物'
  | '时序'
  | '咏史'
  | '爱国'
  | '励志'
  | '治学'
  | '修身'
  | '人生'
  | '艺术';

/** 全部主题标签的稳定顺序（用于列表与校验）。 */
export const CATEGORIES: readonly Category[] = [
  '山水',
  '田园',
  '边塞',
  '战争',
  '思乡',
  '送别',
  '爱情',
  '友情',
  '咏物',
  '时序',
  '咏史',
  '爱国',
  '励志',
  '治学',
  '修身',
  '人生',
  '艺术',
];

/** 一条词句。 */
export interface Quote {
  /** 稳定标识，形如 q001。 */
  readonly id: string;
  /** 正文（简体，无空格与引号）。 */
  readonly text: string;
  /** 作者；无名氏类作品记为「佚名」。 */
  readonly author: string;
  /** 朝代，如「唐」「宋」「先秦」。 */
  readonly dynasty: string;
  /** 出处篇名。 */
  readonly source: string;
  /** 体裁。 */
  readonly sourceKind: SourceKind;
  /** 主题标签，至少一个。 */
  readonly categories: readonly Category[];
  /** 可选补充说明。 */
  readonly note?: string;
}

/** 对外返回的一条结果：词句本体 + 可追溯的日期/序号信息。 */
export interface QuoteResult extends Quote {
  /** 该结果对应的日期（YYYY-MM-DD，北京时间）。 */
  readonly date: string;
  /** 该日期在词库中的序号（从 1 开始），便于「今日是第几首」这类用法。 */
  readonly dailyIndex: number;
  /** 词库总条数。 */
  readonly total: number;
}
