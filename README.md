# get-req

AI辅助的熟人需求收集与澄清工具。通过邀请码定向分发，AI 聊天式澄清将模糊想法梳理成结构化需求文档，沉淀到 Notion 知识库。

## 快速开始

```bash
pnpm install

# 配置环境变量
cp .env.example .env.local
# 编辑 .env.local 填入 OPENAI_API_KEY、NOTION_TOKEN 等

# 创建初始邀请码
pnpm db:seed            # 默认创建 HELLO2025
pnpm db:seed MY_CODE    # 或指定自定义邀请码

# 启动开发服务器（端口 3300）
pnpm dev
```

## 端口约定

| 环境 | 端口 | 启动方式 |
|------|------|----------|
| 开发（dev） | `3300` | `pnpm dev` |
| 生产（production） | `3400` | PM2（见下） |

两个端口相互隔离，本地开发与生产可同机并存，不会冲突。

## 生产环境部署（PM2）

```bash
# 首次：全局安装 pm2（若未安装）
npm i -g pm2

# 构建 + 用 PM2 启动（端口 3400）
pnpm pm2:start        # = pnpm build && pm2 start ecosystem.config.js

# 代码更新后热重载（先构建再 reload，零停机）
pnpm pm2:reload

# 停止 / 查看日志
pnpm pm2:stop
pnpm pm2:logs

# 开机自启（可选）
pm2 startup           # 按提示执行输出的命令
pm2 save
```

进程名为 `get-req`，日志输出到 `./logs/`。生产环境的环境变量请写入 `.env.production`（或 `.env.local`），端口已在 `ecosystem.config.js` 中固定为 `3400`。

## 页面说明

| 路径 | 说明 |
|------|------|
| `/` | 首页：输入邀请码 + 填写联系方式 → 进入 AI 聊天 |
| `/chat?session=TOKEN` | 聊天页：与 AI 多轮对话澄清需求 |
| `/admin` | 运营后台：管理邀请码、查看/评审需求文档 |

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 是 | OpenAI API Key |
| `OPENAI_MODEL` | 否 | 模型名称，默认 `gpt-4o` |
| `NOTION_TOKEN` | 否 | Notion Integration Token（不配则降级为微信联系） |
| `NOTION_PARENT_PAGE_ID` | 否 | 预览版页面的 Notion 父页面 ID。**需手动将该父页面设为 Public（Share to web）**，Notion API 不支持通过代码开启分享，子页面才能继承生成可公开访问的 `public_url`；否则用户收到的链接仅登录 Notion 账号后才能打开 |
| `NOTION_PRIVATE_PARENT_PAGE_ID` | 否 | 完整版页面的 Notion 父页面 ID，**必须保持 Private（不分享）**，与 `NOTION_PARENT_PAGE_ID` 分开设置，避免完整版内容随公开父页面被外部访问 |
| `OPERATOR_WECHAT` | 否 | 运营者微信号（Notion 失败时的降级联系方式） |
| `ADMIN_SECRET` | 是 | 运营后台（`/admin` 及其 API）访问密钥，未配置时管理类接口一律拒绝访问 |
