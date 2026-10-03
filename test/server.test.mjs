// MCP 协议层端到端联调：真实建立 client↔server 连接，逐个调用工具并校验返回。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../dist/server.js';
import { TOTAL } from '../dist/index.js';

/** 建立一个内存传输的 client/server 对。 */
async function connect() {
  const server = createServer({ version: 'test' });
  const client = new Client({ name: 'haoju-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server };
}

/** 取出第一个 text 内容块。 */
function firstText(result) {
  const block = result.content.find((c) => c.type === 'text');
  assert.ok(block, '应返回 text 内容块');
  return block.text;
}

/** 取出结构化 JSON（约定为最后一个 text 块）。 */
function jsonOf(result) {
  const blocks = result.content.filter((c) => c.type === 'text');
  return JSON.parse(blocks[blocks.length - 1].text);
}

test('工具清单：注册了预期的 5 个工具', async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    'get_daily_quote',
    'get_quote_by_date',
    'get_random_quote',
    'list_quote_topics',
    'search_quotes',
  ]);
  for (const tool of tools) {
    assert.ok(tool.description && tool.description.length > 10, `${tool.name} 缺少描述`);
    assert.ok(tool.inputSchema, `${tool.name} 缺少 inputSchema`);
  }
  await client.close();
});

test('get_daily_quote：返回可读文本 + 结构化数据，同日恒定', async () => {
  const { client } = await connect();
  const a = await client.callTool({ name: 'get_daily_quote', arguments: {} });
  const b = await client.callTool({ name: 'get_daily_quote', arguments: {} });
  const dataA = jsonOf(a);
  assert.equal(dataA.quote.total, TOTAL);
  assert.equal(dataA.timeZone, 'Asia/Shanghai');
  assert.match(dataA.quote.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(jsonOf(b).quote.id, dataA.quote.id);
  assert.ok(firstText(a).includes('——'), '可读文本应包含出处行');
  await client.close();
});

test('get_daily_quote：非法时区给出可读错误而非崩溃', async () => {
  const { client } = await connect();
  const res = await client.callTool({ name: 'get_daily_quote', arguments: { timeZone: 'Not/AZone' } });
  assert.ok(firstText(res).includes('时区无法识别'));
  await client.close();
});

test('get_random_quote：seed 可复现，category 被尊重', async () => {
  const { client } = await connect();
  const a = jsonOf(await client.callTool({ name: 'get_random_quote', arguments: { seed: 'abc' } }));
  const b = jsonOf(await client.callTool({ name: 'get_random_quote', arguments: { seed: 'abc' } }));
  assert.equal(a.quote.id, b.quote.id);

  const c = jsonOf(await client.callTool({ name: 'get_random_quote', arguments: { seed: 'x', category: '边塞' } }));
  assert.ok(c.quote.categories.includes('边塞'), `期望边塞主题，实际 ${c.quote.categories.join(',')}`);
  await client.close();
});

test('search_quotes：命中、空结果提示、参数校验', async () => {
  const { client } = await connect();

  const hit = jsonOf(await client.callTool({ name: 'search_quotes', arguments: { keyword: '明月' } }));
  assert.ok(hit.count >= 1);
  assert.ok(hit.results.every((r) => r.text.includes('明月') || r.author.includes('明月') || r.source.includes('明月')));

  const none = await client.callTool({ name: 'search_quotes', arguments: { keyword: 'zzz绝不存在zzz' } });
  assert.ok(firstText(none).includes('没有匹配结果'));
  assert.ok(firstText(none).includes('可用主题'), '空结果应给出可用维度');

  // 超界 limit：不同 SDK 版本可能在 schema 层拒绝，也可能放行到工具内夹紧。
  // 两种都算合格行为，这里只要求「不越界返回垃圾」。
  const clamped = await client.callTool({ name: 'search_quotes', arguments: { limit: 999 } });
  if (clamped.isError) {
    assert.ok(firstText(clamped).length > 0, '拒绝时应给出可读错误信息');
  } else {
    assert.ok(jsonOf(clamped).count <= 50, 'limit 超上限不应返回超过 50 条');
  }
  await client.close();
});

test('get_quote_by_date：指定日期、最近 N 天、非法日期', async () => {
  const { client } = await connect();

  const one = jsonOf(await client.callTool({ name: 'get_quote_by_date', arguments: { date: '2024-02-29' } }));
  assert.equal(one.quote.date, '2024-02-29');

  const many = jsonOf(await client.callTool({ name: 'get_quote_by_date', arguments: { days: 5 } }));
  assert.equal(many.days, 5);
  assert.equal(many.quotes.length, 5);
  assert.equal(new Set(many.quotes.map((q) => q.date)).size, 5);

  const bad = await client.callTool({ name: 'get_quote_by_date', arguments: { date: '2025-02-29' } });
  assert.ok(firstText(bad).includes('日期格式'));

  // 不传参数等价于今天
  const today = jsonOf(await client.callTool({ name: 'get_quote_by_date', arguments: {} }));
  assert.match(today.quote.date, /^\d{4}-\d{2}-\d{2}$/);
  await client.close();
});

test('list_quote_topics：返回全部维度', async () => {
  const { client } = await connect();
  const res = await client.callTool({ name: 'list_quote_topics', arguments: {} });
  const facets = jsonOf(res);
  assert.equal(facets.total, TOTAL);
  assert.ok(facets.categories.length >= 15);
  assert.ok(facets.dynasties.length >= 4);
  assert.ok(facets.authors.length > 50);
  await client.close();
});
