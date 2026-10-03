// 从 chinese-poetry/chinese-poetry 下载原始语料，仅用于本地生成词库。
// 生成结果已提交到 src/data/，日常构建与运行不需要联网。
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data-source', 'raw');
// 走 jsDelivr CDN 而不是 raw.githubusercontent.com：部分网络环境下 GitHub 域名会被
// 本地 hosts 劫持到 127.0.0.1；jsDelivr 镜像同一仓库同一分支，内容一致。
const BASE = 'https://cdn.jsdelivr.net/gh/chinese-poetry/chinese-poetry@master';

const SOURCES = [
  ['全唐诗/唐诗三百首.json', 'tangshi300.json'],
  ['宋词/宋词三百首.json', 'songci300.json'],
  ['诗经/shijing.json', 'shijing.json'],
  ['楚辞/chuci.json', 'chuci.json'],
  ['论语/lunyu.json', 'lunyu.json'],
  ['四书五经/daxue.json', 'daxue.json'],
  ['四书五经/zhongyong.json', 'zhongyong.json'],
  ['四书五经/mengzi.json', 'mengzi.json'],
  ['幽梦影/youmengying.json', 'youmengying.json'],
  ['蒙学/guwenguanzhi.json', 'guwenguanzhi.json'],
  ['蒙学/zengguangxianwen.json', 'zengguangxianwen.json'],
  ['蒙学/qianjiashi.json', 'qianjiashi.json'],
];

await mkdir(OUT, { recursive: true });

for (const [remote, local] of SOURCES) {
  const url = `${BASE}/${encodeURI(remote)}`;
  process.stdout.write(`↓ ${remote} ... `);
  const res = await fetch(url);
  if (!res.ok) {
    console.log(`FAILED ${res.status}`);
    process.exitCode = 1;
    continue;
  }
  const text = await res.text();
  await writeFile(join(OUT, local), text, 'utf8');
  // 校验 JSON 合法，避免把错误页写进缓存
  try {
    const parsed = JSON.parse(text);
    console.log(`ok ${(text.length / 1024).toFixed(0)}KB ${Array.isArray(parsed) ? `array[${parsed.length}]` : `object{${Object.keys(parsed).length}}`}`);
  } catch (err) {
    console.log(`INVALID JSON: ${err.message}`);
    process.exitCode = 1;
  }
}
