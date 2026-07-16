import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// 手动加载 .env 到 process.env（项目未装 dotenv；测试运行器需要 ADMIN_SECRET 发送鉴权头）。
// next start 自身会加载 .env，这里只为测试进程补齐同样的变量。
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const PORT = Number(process.env.E2E_PORT ?? 3410);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // 共享同一 SQLite 文件与内存限流态，串行更稳定
  workers: 1,
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // 本地复用已在跑的 3410；未占用时构建并启动（CI 场景）。
    command: `node_modules/.bin/next build && node_modules/.bin/next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
