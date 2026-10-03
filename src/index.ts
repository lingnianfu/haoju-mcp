/**
 * 库入口：把查询能力与词库数据暴露给其他 Node 程序使用。
 *
 * MCP Server 的启动点在 ./cli.js；这里只导出纯函数与数据，便于被当作依赖调用。
 */
export { createServer } from './server.js';
export * from './data/index.js';
