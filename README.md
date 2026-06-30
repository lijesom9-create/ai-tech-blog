# AI Tech Blog - 自动化技术博客

## 🎯 项目概述

这是一个全自动化的AI技术博客系统，涵盖：
- 🧠 大语言模型（LLM）原理与实践
- 🤖 AI Agent 框架与应用
- 🔍 RAG 检索增强生成技术
- 🛠️ AI 工具评测与推荐
- 📖 实战教程从零到一

## 🚀 技术栈

- **博客框架**: Hexo
- **主题**: Butterfly
- **部署**: GitHub Pages + GitHub Actions
- **自动化**: Node.js 脚本

## 📦 项目结构

```
ai-tech-blog/
├── source/
│   └── _posts/          # 博客文章
├── scripts/
│   └── content-generator.js  # 内容生成脚本
├── .github/
│   └── workflows/
│       └── deploy.yml   # 自动部署配置
├── _config.yml          # Hexo配置
└── _config.butterfly.yml # 主题配置
```

## 🔧 本地开发

```bash
# 安装依赖
npm install

# 本地预览
npx hexo server

# 生成静态文件
npx hexo generate

# 部署（自动通过GitHub Actions）
git add .
git commit -m "更新内容"
git push origin main
```

## 📝 内容生成

### 手动生成

```bash
# 生成教程
node scripts/content-generator.js generate "Transformer架构" LLM

# 查看待生成主题
node scripts/content-generator.js schedule

# 查看生成日志
node scripts/content-generator.js log
```

### 自动化流程

1. **爬取阶段**: 定时抓取技术文档更新
2. **分析阶段**: AI分析提取核心知识点
3. **生成阶段**: 按模板生成Markdown教程
4. **发布阶段**: Git推送自动部署

## 🌐 访问地址

- **博客**: https://lijesom9-create.github.io/ai-tech-blog/
- **仓库**: https://github.com/lijesom9-create/ai-tech-blog

## 📋 内容规划

### 第一周
- [ ] Transformer架构深度解析
- [ ] LangChain Agent开发实战
- [ ] RAG系统从零搭建

### 第二周
- [ ] LoRA微调实战指南
- [ ] AutoGen多Agent协作
- [ ] 向量数据库选型指南

### 第三周
- [ ] Prompt Engineering高级技巧
- [ ] CrewAI角色扮演Agent
- [ ] 检索策略优化

### 第四周
- [ ] 推理优化（量化、KV Cache）
- [ ] AI应用部署上线
- [ ] 模型评测对比

## 🔄 自动化工作流

```
┌──────────────────────────────────────────────────────┐
│  1️⃣ 爬取阶段（每日/每周定时）                         │
│  ├─ 来源：HuggingFace、LangChain、OpenAI...          │
│  ├─ 抓取新文章/文档更新                               │
│  └─ 存入本地知识库                                    │
├──────────────────────────────────────────────────────┤
│  2️⃣ 分析阶段                                         │
│  ├─ 提取核心知识点                                    │
│  ├─ 判断：是否适合做教程？                             │
│  └─ 生成大纲 + 代码示例                               │
├──────────────────────────────────────────────────────┤
│  3️⃣ 生成阶段                                         │
│  ├─ 按模板生成 Markdown 教程                          │
│  ├─ 添加：标题/标签/封面图                            │
│  └─ 存入 Hexo _posts/ 目录                           │
├──────────────────────────────────────────────────────┤
│  4️⃣ 发布阶段                                         │
│  ├─ git push → GitHub Pages 自动部署                 │
│  └─ 记录日志 + 通知                                   │
└──────────────────────────────────────────────────────┘
```

## 📞 联系方式

- GitHub: [lijesom9-create](https://github.com/lijesom9-create)

---

*Powered by Hexo + Butterfly Theme*
