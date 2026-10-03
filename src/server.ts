/**
 * 每日好词好句 MCP Server。
 *
 * 设计取舍：
 *   1. 词库内置（编译进 dist），因此断网可用、启动即用，不受第三方接口稳定性影响；
 *   2. 工具返回同时给「人类可读文本」与「结构化 JSON」，模型既能直接朗读，
 *      也能拿到稳定字段做后续处理（例如按 id 去重、按 categories 归档）；
 *   3. 每日一句按北京时间零点切换，同一日期在所有客户端得到同一条。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  CATEGORIES,
  DEFAULT_TIME_ZONE,
  getDailyQuote,
  getQuoteByDate,
  getRandomQuote,
  getRecentDates,
  listFacets,
  searchQuotes,
} from './data/index.js';
import type { QuoteResult } from './data/types.js';

/** 一条词句渲染成给人看的文本。 */
function render(quote: QuoteResult): string {
  const lines = [
    `「${quote.text}」`,
    `—— ${quote.dynasty}·${quote.author}《${quote.source}》`,
    `主题：${quote.categories.join('、')} ｜ 体裁：${quote.sourceKind}`,
  ];
  if (quote.note) lines.push(`备注：${quote.note}`);
  return lines.join('\n');
}

/** 统一的结果封装：一份可读文本 + 一份结构化数据。 */
function reply(quote: QuoteResult, extra?: Record<string, unknown>) {
  const payload = { quote, ...(extra ?? {}) };
  return {
    content: [
      { type: 'text' as const, text: render(quote) },
      { type: 'text' as const, text: JSON.stringify(payload, null, 2) },
    ],
  };
}

/** 无匹配结果时的统一回复。 */
function emptyReply(hint: string) {
  return {
    content: [{ type: 'text' as const, text: hint }],
    isError: false as const,
  };
}

export interface CreateServerOptions {
  name?: string;
  version?: string;
}

/** 创建一个已完成工具注册的 MCP Server（尚未连接 transport）。 */
export function createServer(options: CreateServerOptions = {}): McpServer {
  const server = new McpServer({
    name: options.name ?? 'haoju-mcp',
    version: options.version ?? '0.1.0',
  });

  server.registerTool(
    'get_daily_quote',
    {
      title: '每日好词好句',
      description:
        '获取「今天」的一句好词好句。按指定时区的自然日切换（默认 Asia/Shanghai），同一日期恒定返回同一条，因此适合做每日推送、打卡、签到等场景。',
      inputSchema: {
        timeZone: z
          .string()
          .optional()
          .describe('IANA 时区名，决定「今天」怎么算，例如 Asia/Shanghai、America/New_York。默认 Asia/Shanghai。'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ timeZone }) => {
      try {
        const quote = getDailyQuote(timeZone ? { timeZone } : {});
        return reply(quote, { timeZone: timeZone ?? DEFAULT_TIME_ZONE });
      } catch (error) {
        return emptyReply(`时区无法识别：${timeZone}。请使用 IANA 名称，例如 Asia/Shanghai。(${(error as Error).message})`);
      }
    },
  );

  server.registerTool(
    'get_random_quote',
    {
      title: '随机好词好句',
      description:
        '随机返回一句好词好句。可传 seed 让结果可复现（同一 seed 恒定同一条，适合「我们各抽一句来对比」这类玩法），也可传 category 限定主题。',
      inputSchema: {
        seed: z
          .union([z.string(), z.number()])
          .optional()
          .describe('可复现随机种子。传了它，相同 seed 永远得到同一条；不传则真随机。'),
        category: z
          .enum(CATEGORIES as unknown as [string, ...string[]])
          .optional()
          .describe('限定主题，例如 励志、思乡、爱情、山水。'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ seed, category }) => {
      const base = getRandomQuote(seed);
      if (!category || base.categories.includes(category as (typeof CATEGORIES)[number])) {
        return reply(base, { seed: seed ?? null });
      }
      // 指定了主题但没抽中，则在主题内做一次带种子的选取，保证结果仍然可复现
      const pool = searchQuotes({
        categories: [category as (typeof CATEGORIES)[number]],
        limit: 50,
      });
      if (pool.length === 0) {
        return emptyReply(`词库中没有主题为「${category}」的词句。可用主题：${CATEGORIES.join('、')}`);
      }
      const pick = seed === undefined || seed === ''
        ? pool[Math.floor(Math.random() * pool.length)]
        : pool[Math.abs(hashSeed(seed)) % pool.length];
      return reply(pick as QuoteResult, { seed: seed ?? null, category });
    },
  );

  server.registerTool(
    'search_quotes',
    {
      title: '检索好词好句',
      description:
        '在内置词库里检索。支持关键词（正文/作者/出处，忽略标点）、主题标签、作者、朝代、体裁，可组合使用。返回按相关度排序的结果。',
      inputSchema: {
        keyword: z.string().optional().describe('关键词，例如「明月」「苏轼」「相思」。忽略标点，「天生我材」可命中完整句。'),
        category: z
          .enum(CATEGORIES as unknown as [string, ...string[]])
          .optional()
          .describe('主题标签，例如 边塞、咏物、治学。'),
        author: z.string().optional().describe('作者名，包含匹配，例如「李」「苏东坡」。'),
        dynasty: z.string().optional().describe('朝代，精确匹配，例如 唐、宋、先秦。'),
        sourceKind: z.enum(['诗', '词', '辞', '赋', '文', '子']).optional().describe('体裁。'),
        limit: z.number().int().min(1).max(50).optional().describe('返回条数上限，默认 10。'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ keyword, category, author, dynasty, sourceKind, limit }) => {
      const results = searchQuotes({
        ...(keyword !== undefined ? { keyword } : {}),
        ...(author !== undefined ? { author } : {}),
        ...(dynasty !== undefined ? { dynasty } : {}),
        ...(sourceKind !== undefined ? { sourceKind } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(category ? { categories: [category as (typeof CATEGORIES)[number]] } : {}),
      });
      if (results.length === 0) {
        const facets = listFacets();
        return emptyReply(
          `没有匹配结果。\n可用主题：${facets.categories.join('、')}\n可用朝代：${facets.dynasties.join('、')}\n可用体裁：${facets.sourceKinds.join('、')}`,
        );
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: results.map((r, i) => `${i + 1}. ${render(r)}`).join('\n\n'),
          },
          { type: 'text' as const, text: JSON.stringify({ count: results.length, results }, null, 2) },
        ],
      };
    },
  );

  server.registerTool(
    'get_quote_by_date',
    {
      title: '按日期取佳句',
      description:
        '取指定日期的每日一句，用于回顾历史、补签、或「去年的今天说了什么」。也可用 days 一次取出最近若干天。',
      inputSchema: {
        date: z.string().optional().describe('日期，格式 YYYY-MM-DD。与 days 二选一；都不传则取今天。'),
        days: z
          .number()
          .int()
          .min(1)
          .max(60)
          .optional()
          .describe('取最近 N 天（含今天），按日期倒序。与 date 二选一。'),
        timeZone: z.string().optional().describe('IANA 时区名，默认 Asia/Shanghai。'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ date, days, timeZone }) => {
      try {
        if (days !== undefined) {
          const list = getRecentDates(days, timeZone ? { timeZone } : {});
          return {
            content: [
              {
                type: 'text' as const,
                text: list.map((r) => `${r.date}\n${render(r)}`).join('\n\n'),
              },
              { type: 'text' as const, text: JSON.stringify({ days: list.length, quotes: list }, null, 2) },
            ],
          };
        }
        if (date !== undefined && date !== '') {
          return reply(getQuoteByDate(date));
        }
        return reply(getDailyQuote(timeZone ? { timeZone } : {}));
      } catch (error) {
        return emptyReply(`${(error as Error).message}`);
      }
    },
  );

  server.registerTool(
    'list_quote_topics',
    {
      title: '查看可用主题与维度',
      description:
        '列出词库的可用主题、朝代、体裁、作者与总条数。在不确定该用什么条件检索时先调用它。',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const facets = listFacets();
      return {
        content: [
          {
            type: 'text' as const,
            text: [
              `词库共 ${facets.total} 条。`,
              `主题（${facets.categories.length}）：${facets.categories.join('、')}`,
              `朝代（${facets.dynasties.length}）：${facets.dynasties.join('、')}`,
              `体裁（${facets.sourceKinds.length}）：${facets.sourceKinds.join('、')}`,
              `作者（${facets.authors.length}）：${facets.authors.slice(0, 40).join('、')}${facets.authors.length > 40 ? ' …' : ''}`,
            ].join('\n'),
          },
          { type: 'text' as const, text: JSON.stringify(facets, null, 2) },
        ],
      };
    },
  );

  return server;
}

/** 与 query.ts 中同义的轻量哈希，供工具层做主题内复现随机。 */
function hashSeed(seed: string | number): number {
  const text = `seed:${seed}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
