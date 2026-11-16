# 拾简 · 个人信息管家 Agent

一个用于记录零散想法、资料和待办的中文 Web 应用。记录保存后可由大模型自动分类、提取重点、生成摘要，并关联已有内容。你可以向资料库提问，也可以回顾一个阶段的进展并整理后续行动。

## 功能

- **快速记录** 支持想法、资料、待办三种类别，保存标题与正文。
- **资料检索** 按关键词搜索标题、正文和智能整理结果，支持分页浏览。
- **智能整理** 自动分类、摘要、重点提取、待办提取和相关记录推荐，保留原文供回看。
- **智能问答** 根据已有记录回答问题，展示可以点击查看的引用记录。
- **待办管理** 标记完成、重新打开，以及将提取的事项或行动建议加入待办。
- **阶段总结** 生成最近 7、30 或 90 天的总结和后续行动建议。

配置 `OPENAI_API_KEY` 后启用模型功能。未配置时，记录、搜索和待办功能仍可使用。

## 快速开始

需要 Node.js 24 或更新版本。应用使用 Node.js 内置模块，无第三方运行依赖。

```sh
git clone https://github.com/zelongw519-glitch/personal-information-agent.git
cd personal-information-agent
npm start
```

在浏览器打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)。启动命令会自动构建页面与 Worker，并初始化本地数据库。按 `Ctrl+C` 停止服务。

本地数据保存在 `data/personal-information-agent.sqlite`，重启后继续保留。本地开发使用固定的单用户身份，只监听 `127.0.0.1`。云端运行使用 Sites 提供的 ChatGPT 登录与账号隔离。

## 配置大模型

将 `.env.example` 复制为 `.env`，填写自己的 OpenAI API 密钥，然后重新运行 `npm start`。

PowerShell 中可使用以下命令复制配置。

```powershell
Copy-Item .env.example .env
```

macOS 或 Linux 中使用以下命令。

```sh
cp .env.example .env
```

| 配置项 | 用途 | 默认值 |
| --- | --- | --- |
| `OPENAI_API_KEY` | 服务端调用 OpenAI API 的密钥 | 空，模型功能等待配置 |
| `OPENAI_MODEL` | 支持 Chat Completions 和 JSON 输出的模型 | `gpt-4.1-mini` |
| `PORT` | 本地服务端口 | `3000` |

模型请求由服务端发送至 OpenAI，分析时会发送相关记录内容。`.env` 与本地数据库已在 `.gitignore` 中排除。云端密钥通过 Sites 的服务端环境变量配置。

## 云端部署

项目保留 Sites 的 Cloudflare Worker 与 D1 部署结构。

1. 使用 Sites 创建站点，取得该站点的 `project_id`。
2. 将 `project_id` 添加到 `.openai/hosting.json`，保留 `d1` 为 `DB`。
3. 配置站点的服务端环境变量 `OPENAI_API_KEY`，按需配置 `OPENAI_MODEL`。
4. 运行 `npm run build`，通过 Sites 源码同步与发布流程保存、部署构建产物。
5. 发布流程应用 `drizzle/` 下的数据库迁移，并提供登录、身份头和 D1 绑定。

构建入口为 `dist/server/index.js`，导出 Worker 的 `fetch(request, env)`。运行时依赖 `env.DB`。API 使用 Sites 提供的 `oai-authenticated-user-id` 进行数据隔离，写请求校验同源 `Origin`。部署到其他平台时，需要先接入可信的身份认证层与相应的数据存储适配。

本地数据与云端数据分别保存。这个源码仓库包含应用和数据库结构，首次运行使用空数据库。

## 开发与验证

```sh
npm run build
npm test
```

测试覆盖本地服务重启后的数据持久化、关键词搜索与待办状态、外部来源请求拦截、云端账号隔离，以及模型引用来源过滤。模型测试使用模拟响应，可在没有 API 密钥的环境下运行。

```text
index.html                  页面、样式和浏览器交互
worker.mjs                  共享 API、模型调用和记录检索
server.mjs                  本地 HTTP 服务
local-db.mjs                SQLite 迁移与 D1 接口适配
build.mjs                   生成 Worker 部署产物
drizzle/                    数据库迁移及迁移日志
test/app.test.mjs           端到端接口与隔离测试
.openai/hosting.json        Sites 数据库绑定声明
.env.example                环境变量示例
```

## 当前范围

- 资料以粘贴的文本形式记录，单条正文最多 12,000 字符。
- 自动整理在浏览器保存记录后触发。模型失败时原文保留，可在卡片上重新整理。
- 关联记录从近期最多 180 条候选中选出最多 14 条供模型分析。
- 问答在近期最多 181 条记录中按关键词匹配，最多参考 24 条。阶段总结在选定时间范围内最多参考 60 条。
- 问答和阶段总结中的每条正文最多取前 950 字符，另附已有摘要。结果会展示参考范围。
- 资料库规模较大时，上述上下文限制会影响答案覆盖范围。可通过关键词检索回看完整记录。

OpenAI 接口说明见官方文档。[Chat Completions](https://platform.openai.com/docs/api-reference/chat)
