#!/usr/bin/env node
/**
 * CLI 入口：既作为 MCP Server 的标准启动点（stdio），
 * 也提供几个直接可用的命令行子命令，方便不开客户端就试一下词库。
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { getDailyQuote, getQuoteByDate, getRandomQuote, searchQuotes, listFacets } from './data/index.js';
import type { QuoteResult } from './data/types.js';

const PKG_VERSION = '0.1.0';

const HELP = `每日好词好句 MCP Server v${PKG_VERSION}

作为 MCP Server 启动（默认行为，走 stdio）：
  haoju-mcp

命令行直接试用：
  haoju-mcp today                 今天的佳句
  haoju-mcp random [seed]         随机一句（可给 seed 复现）
  haoju-mcp search <关键词> [-n N] 检索
  haoju-mcp date <YYYY-MM-DD>     指定日期
  haoju-mcp topics                可用主题/朝代/体裁
  haoju-mcp --help | --version

在 MCP 客户端里配置（例如 Claude Desktop / DeepSeek Harness）：
  { "mcpServers": { "haoju": { "command": "npx", "args": ["-y", "haoju-mcp"] } } }
`;

function render(quote: QuoteResult): string {
  return `「${quote.text}」\n—— ${quote.dynasty}·${quote.author}《${quote.source}》\n   ${quote.date} ｜ ${quote.categories.join('、')} ｜ ${quote.sourceKind}`;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(HELP);
    return;
  }
  if (command === '--version' || command === '-v') {
    process.stdout.write(`${PKG_VERSION}\n`);
    return;
  }

  if (command === 'today') {
    process.stdout.write(`${render(getDailyQuote())}\n`);
    return;
  }
  if (command === 'random') {
    process.stdout.write(`${render(getRandomQuote(rest[0]))}\n`);
    return;
  }
  if (command === 'date') {
    const date = rest[0];
    if (!date) {
      process.stderr.write('用法：haoju-mcp date <YYYY-MM-DD>\n');
      process.exitCode = 2;
      return;
    }
    process.stdout.write(`${render(getQuoteByDate(date))}\n`);
    return;
  }
  if (command === 'search') {
    const limitIndex = rest.findIndex((a) => a === '-n' || a === '--limit');
    const limit = limitIndex >= 0 ? Number(rest[limitIndex + 1]) : 10;
    const keyword = rest.filter((_, i) => i !== limitIndex && i !== limitIndex + 1).join(' ');
    const results = searchQuotes({ keyword, limit: Number.isFinite(limit) ? limit : 10 });
    if (results.length === 0) {
      process.stdout.write(`没有匹配「${keyword}」的词句。\n`);
      return;
    }
    process.stdout.write(`${results.map((r, i) => `${i + 1}. ${render(r)}`).join('\n\n')}\n`);
    return;
  }
  if (command === 'topics') {
    const facets = listFacets();
    process.stdout.write(
      `词库共 ${facets.total} 条\n主题：${facets.categories.join('、')}\n朝代：${facets.dynasties.join('、')}\n体裁：${facets.sourceKinds.join('、')}\n`,
    );
    return;
  }
  if (command !== undefined && !command.startsWith('-')) {
    process.stderr.write(`未知子命令：${command}\n\n${HELP}`);
    process.exitCode = 2;
    return;
  }

  // 默认：作为 MCP Server 启动
  const server = createServer({ version: PKG_VERSION });
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  process.stderr.write(`启动失败：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
