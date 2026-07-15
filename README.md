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

# 启动开发服务器
pnpm dev
```

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
| `NOTION_PARENT_PAGE_ID` | 否 | Notion 父页面 ID。**需手动将该父页面设为 Public（Share to web）**，Notion API 不支持通过代码开启分享，子页面才能继承生成可公开访问的 `public_url`；否则用户收到的链接仅登录 Notion 账号后才能打开 |
| `OPERATOR_WECHAT` | 否 | 运营者微信号（Notion 失败时的降级联系方式） |
| `ADMIN_SECRET` | 是 | 运营后台（`/admin` 及其 API）访问密钥，未配置时管理类接口一律拒绝访问 |
