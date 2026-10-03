# 每日好词好句 MCP Server

一个**离线可用**的中文佳句 MCP Server。内置 214 条精选唐诗、宋词、诗经、楚辞、论语、道德经名句，
提供「每日一句 / 随机 / 检索 / 按日期查询」四类能力。

- **零网络依赖**：词库编译进包内，断网、内网、飞行模式都能用，不依赖任何第三方接口。
- **稳定可复现**：每日一句按北京时间零点切换，同一日期在任何客户端都得到同一条。
- **原文可靠**：所有诗句由脚本从 `chinese-poetry` 权威语料按索引抽取并逐条校验，不是手工转录。
- **零运行时依赖**：除 MCP SDK 与 zod 外没有别的依赖，`npx` 拉起很快。

## 快速开始

### 1. 克隆并构建

```bash
npm install
npm run build
```

### 2. 在 MCP 客户端里配置

```json
{
  "mcpServers": {
    "haoju": {
      "command": "node",
      "args": ["D:/开发工作/每日好词好句-mcp/dist/cli.js"]
    }
  }
}
```

发布到 npm 后可直接用：

```json
{
  "mcpServers": {
    "haoju": { "command": "npx", "args": ["-y", "haoju-mcp"] }
  }
}
```

### 3. 不开客户端，命令行直接试

```bash
node dist/cli.js today                  # 今天的佳句
node dist/cli.js random 42              # 随机一句（给 seed 可复现）
node dist/cli.js search 明月 -n 3        # 检索
node dist/cli.js date 2026-01-01        # 指定日期
node dist/cli.js topics                 # 可用主题 / 朝代 / 体裁
```

输出示例：

```
「秦时明月汉时关，万里长征人未还。」
—— 唐·王昌龄《横吹曲辞出塞一》
   2026-10-04 ｜ 边塞、思乡 ｜ 诗
```

## 提供的工具

| 工具 | 作用 | 关键参数 |
|---|---|---|
| `get_daily_quote` | 今天的每日一句 | `timeZone`（IANA 时区，默认 `Asia/Shanghai`） |
| `get_random_quote` | 随机一句 | `seed`（可复现）、`category`（限定主题） |
| `search_quotes` | 检索词库 | `keyword` / `category` / `author` / `dynasty` / `sourceKind` / `limit` |
| `get_quote_by_date` | 按日期取句 | `date` 或 `days`（最近 N 天）、`timeZone` |
| `list_quote_topics` | 列出可用维度 | 无 |

每个工具都会返回**两份内容**：一份给人读的文本（可直接朗读/推送），一份结构化 JSON
（含 `id`、`text`、`author`、`dynasty`、`source`、`sourceKind`、`categories`），
方便模型做后续处理。

### 设计要点

**为什么每日一句要按日期取？**
`dateIndex(date)` 用 FNV-1a 把 `YYYY-MM-DD` 哈希成词库下标。同一日期恒定映射到同一条，
不同日期则被打散（连续两个月不会出现「今天和明天是相邻两条」的机械感）。
你可以直接调用 `getDailyQuote()` 复现任何一天的推送内容。

**为什么默认时区是 `Asia/Shanghai`？**
「今天」是个时区相关的概念。选北京时间让国内用户的切换点落在自然日零点；
需要别的语义时传 `timeZone` 即可，跨零点行为有专门的测试覆盖。

**关键词为什么能忽略标点？**
匹配前会把两边都做「去标点归一化」，所以搜「天生我材」能命中
「天生我材必有用，千金散尽还复来。」，搜「明月，」和「明月」结果完全一致。

## 词库内容

| 体裁 | 条数 | 来源 |
|---|---|---|
| 诗 | 83 | 唐诗三百首、诗经、千家诗 |
| 词 | 48 | 宋词三百首 |
| 辞 | 10 | 楚辞 |
| 子 | 62 | 论语、大学、中庸、孟子、道德经、幽梦影 |
| 文 | 11 | 增广贤文 |
| **合计** | **214** | 先秦 → 清 |

17 个主题标签：山水、田园、边塞、战争、思乡、送别、爱情、友情、咏物、时序、咏史、爱国、
励志、治学、修身、人生、艺术。

朝代分布：先秦、唐、宋、明、清。

## 开发

```bash
npm install
npm run build      # tsc 编译到 dist/
npm test           # 构建 + 跑全部测试
npm run typecheck  # 只做类型检查
```

### 测试覆盖

`test/` 下 21 个用例，分两层：

- `data.test.mjs` — 数据与查询层：词库字段完整性、无残留繁体、正文不重复、
  日期校验（含闰年）、日期映射的稳定性与分布、时区跨零点、
  检索的标点归一化与组合过滤、limit 夹紧。
- `server.test.mjs` — MCP 协议层：用 `InMemoryTransport` 真实建立 client↔server 连接，
  逐个调用 5 个工具并校验返回结构与错误处理。

### 重新生成词库

词库由脚本从权威语料生成，不是手写的：

```bash
npm run fetch                    # 下载语料（走 jsDelivr 镜像）到 data-source/raw/
node tools/gen-quotes.mjs        # 抽取 + 繁简转换 + 校验 → src/data/quotes.ts
```

- `data-source/selections.json` — 诗、词的篇目选择表（哪一篇、取哪几句）
- `data-source/classics.json` — 典籍名句的定位表
- `tools/scan-missing-t2s.mjs` — 扫描语料，列出繁简转换表还没覆盖的字
- `data-source/audit-t2s.mjs` / `fix-t2s.mjs` — 对照表的结构自检与归一化

生成器内置三道校验：定位失败、转换后残留繁体、正文重复，任一出现即非零退出。

## 数据来源与许可

- 古典诗文：公共领域作品。文本取自
  [chinese-poetry/chinese-poetry](https://github.com/chinese-poetry/chinese-poetry)（MIT）与
  Project Gutenberg eBook #7337（《道德经》，公共领域）。
- 繁简转换表：`src/data/text.ts` 内自建的显式对照表，由语料扫描驱动补充，
  构建时强校验无重复、无「繁简同字」的无效条目。
- 本项目代码：MIT，见 [LICENSE](./LICENSE)。

## 许可与免责

诗句与出处均来自上述语料，若个别异文与通行本不同，以语料为准；生成器会在抽取时
逐条校验并报告问题，不做静默兜底。
