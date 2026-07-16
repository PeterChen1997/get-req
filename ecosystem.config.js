// PM2 生产环境配置
// 使用前先构建：pnpm build （或 pnpm pm2:start 会自动先 build）
// 生产端口固定为 3400，与本地 dev（3300）隔离，避免冲突。
module.exports = {
  apps: [
    {
      name: "get-req",
      // 直接调用本地 next 二进制，避免 pnpm 作为解释器带来的信号/退出码问题
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3400",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: "3400",
      },
      // 日志
      out_file: "./logs/pm2-out.log",
      error_file: "./logs/pm2-error.log",
      merge_logs: true,
      time: true,
    },
  ],
};
