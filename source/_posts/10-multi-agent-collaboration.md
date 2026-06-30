# 多Agent协作架构：DeepScope如何自动化研究

> 一个人研究问题，效率有限。如果能有一群AI助手帮你搜索、分析、总结，效率会怎样？本文基于DeepScope项目的完整实现，解析多Agent协作的研究自动化系统。

## 前言

想象这个场景：

> 你输入："分析2024年AI Agent市场竞争格局"

传统方式：
1. 手动搜索多个关键词
2. 逐个阅读文章
3. 手动整理笔记
4. 写研究报告

**至少需要2-3小时。**

DeepScope的方式：
1. AI自动分解搜索任务
2. 多个Agent并行搜索
3. 分析Agent提取关键信息
4. 写作Agent生成报告

**5分钟搞定。**

## DeepScope系统架构

```
用户输入: "分析2024年AI Agent市场竞争格局"
        │
        ▼
┌─────────────────────────────────────────┐
│           Research Coordinator          │
│         (研究协调器 - 主Agent)          │
│                                         │
│  • 理解用户意图                          │
│  • 分解研究任务                          │
│  • 分配给专业Agent                      │
└─────────────┬───────────────────────────┘
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
┌────────┐┌────────┐┌────────┐
│Search  ││Analysis││Writer  │
│Agent   ││Agent   ││Agent   │
│        ││        ││        │
│• 网页搜索││• 信息分析││• 结构化输出│
│• 内容提取││• 趋势判断││• 引用标注 │
│• 多源验证││• 数据整理││• 图表建议 │
└────────┘└────────┘└────────┘
    │         │         │
    └─────────┼─────────┘
              ▼
    ┌─────────────────┐
    │  研究报告 (MD)   │
    │  • 摘要          │
    │  • 详细分析      │
    │  • 数据支撑      │
    │  • 结论建议      │
    │  • 参考文献      │
    └─────────────────┘
```

## 研究协调器

### 任务分解

```python
# agents/coordinator.py
class ResearchCoordinator:
    """研究协调器"""
    
    def __init__(self, llm):
        self.llm = llm
    
    async def create_research_plan(self, query: str) -> ResearchPlan:
        """创建研究计划"""
        prompt = f"""你是一个研究计划专家。请为以下研究问题制定详细的研究计划：

研究问题：{query}

要求：
1. 理解研究问题的核心需求
2. 分解为可执行的子任务
3. 每个子任务应该是独立的搜索或分析任务
4. 规划任务的执行顺序

请返回JSON格式的研究计划。"""
        
        response = await self.llm.ainvoke(prompt)
        plan = parse_research_plan(response)
        
        return plan
    
    async def coordinate(self, query: str) -> ResearchReport:
        """协调研究流程"""
        # 1. 创建研究计划
        plan = await self.create_research_plan(query)
        print(f"📋 研究计划: {len(plan.subtasks)} 个子任务")
        
        # 2. 并行执行搜索任务
        search_tasks = [t for t in plan.subtasks if t.type == "search"]
        search_results = await self._parallel_search(search_tasks)
        print(f"🔎 搜索完成: {len(search_results)} 条结果")
        
        # 3. 执行分析任务
        analysis_tasks = [t for t in plan.subtasks if t.type == "analysis"]
        analysis_results = await self._run_analysis(analysis_tasks, search_results)
        print(f"📊 分析完成")
        
        # 4. 生成报告
        report = await self._generate_report(query, search_results, analysis_results)
        print(f"📝 报告生成完成")
        
        return report
```

### 任务调度

```python
# agents/scheduler.py
class TaskScheduler:
    """任务调度器"""
    
    def __init__(self, max_concurrent: int = 3):
        self.max_concurrent = max_concurrent
        self.semaphore = asyncio.Semaphore(max_concurrent)
    
    async def execute_tasks(self, tasks: list, agent) -> list:
        """并行执行任务"""
        async def run_with_limit(task):
            async with self.semaphore:
                return await agent.run(task)
        
        results = await asyncio.gather(
            *[run_with_limit(task) for task in tasks],
            return_exceptions=True
        )
        
        return results
```

## 搜索Agent

### 多关键词搜索

```python
# agents/search_agent.py
class SearchAgent:
    """搜索Agent"""
    
    def __init__(self, llm, search_tool, fetch_tool):
        self.llm = llm
        self.search_tool = search_tool
        self.fetch_tool = fetch_tool
    
    async def search(self, task: SearchTask) -> SearchResult:
        """执行搜索任务"""
        # 1. 生成搜索关键词
        keywords = await self._generate_keywords(task.description)
        print(f"   生成 {len(keywords)} 个搜索关键词")
        
        # 2. 并行搜索
        search_results = []
        for keyword in keywords:
            results = await self.search_tool.arun(keyword)
            search_results.extend(results)
        
        # 3. 抓取网页内容
        contents = []
        for result in search_results[:5]:  # 只抓取前5个
            try:
                content = await self.fetch_tool.arun(result["url"])
                contents.append({
                    "url": result["url"],
                    "title": result["title"],
                    "content": content
                })
            except Exception as e:
                print(f"   抓取失败: {result['url']} - {e}")
        
        # 4. 提取关键信息
        key_info = await self._extract_key_info(contents, task.description)
        
        return SearchResult(
            task=task,
            sources=contents,
            key_info=key_info
        )
    
    async def _generate_keywords(self, description: str) -> list[str]:
        """生成搜索关键词"""
        prompt = f"""为以下搜索任务生成3-5个搜索关键词：

任务：{description}

要求：
1. 关键词应该覆盖不同角度
2. 包含中英文关键词
3. 每个关键词应该简洁明确

返回JSON数组格式。"""
        
        response = await self.llm.ainvoke(prompt)
        return json.loads(response)
    
    async def _extract_key_info(self, contents: list, task: str) -> str:
        """提取关键信息"""
        text = "\n\n".join([f"来源: {c['url']}\n{c['content'][:1000]}" for c in contents])
        
        prompt = f"""从以下内容中提取与任务相关的关键信息：

任务：{task}

内容：
{text}

要求：
1. 提取关键事实和数据
2. 标注信息来源
3. 去除无关信息"""
        
        return await self.llm.ainvoke(prompt)
```

## 分析Agent

### 深度分析

```python
# agents/analysis_agent.py
class AnalysisAgent:
    """分析Agent"""
    
    def __init__(self, llm):
        self.llm = llm
    
    async def analyze(self, search_results: list[SearchResult], 
                      analysis_task: str) -> AnalysisResult:
        """执行分析任务"""
        # 1. 整合搜索结果
        all_info = self._consolidate_results(search_results)
        
        # 2. 执行分析
        analysis = await self._deep_analysis(all_info, analysis_task)
        
        # 3. 提取关键发现
        findings = await self._extract_findings(analysis)
        
        return AnalysisResult(
            task=analysis_task,
            analysis=analysis,
            findings=findings
        )
    
    async def _deep_analysis(self, info: str, task: str) -> str:
        """深度分析"""
        prompt = f"""请对以下信息进行深度分析：

分析任务：{task}

信息：
{info}

分析维度：
1. 现状分析：当前的发展状况
2. 趋势分析：未来的发展趋势
3. 对比分析：不同方案的优劣
4. 风险分析：潜在的风险和挑战
5. 机会分析：可能的机会和建议

请提供详细的分析报告。"""
        
        return await self.llm.ainvoke(prompt)
    
    async def _extract_findings(self, analysis: str) -> list[str]:
        """提取关键发现"""
        prompt = f"""从以下分析中提取3-5个关键发现：

{analysis}

每个发现应该是一句简洁的结论。"""
        
        response = await self.llm.ainvoke(prompt)
        return response.split("\n")
```

## 写作Agent

### 报告生成

```python
# agents/writer_agent.py
class WriterAgent:
    """写作Agent"""
    
    def __init__(self, llm):
        self.llm = llm
    
    async def write_report(self, query: str, 
                          search_results: list[SearchResult],
                          analysis_results: list[AnalysisResult]) -> str:
        """生成研究报告"""
        # 1. 规划报告结构
        structure = await self._plan_structure(query)
        
        # 2. 生成各部分
        sections = []
        for section in structure.sections:
            content = await self._write_section(
                section, search_results, analysis_results
            )
            sections.append(content)
        
        # 3. 组装报告
        report = self._assemble_report(structure, sections)
        
        # 4. 添加参考文献
        references = self._extract_references(search_results)
        report += "\n\n## 参考文献\n\n"
        for i, ref in enumerate(references, 1):
            report += f"{i}. [{ref['title']}]({ref['url']})\n"
        
        return report
    
    async def _plan_structure(self, query: str) -> ReportStructure:
        """规划报告结构"""
        prompt = f"""为以下研究报告规划结构：

主题：{query}

要求：
1. 包含摘要、正文、结论
2. 正文分为3-5个主要部分
3. 每部分有明确的主题

返回JSON格式的报告结构。"""
        
        response = await self.llm.ainvoke(prompt)
        return parse_report_structure(response)
    
    async def _write_section(self, section: Section,
                            search_results: list,
                            analysis_results: list) -> str:
        """生成报告章节"""
        # 收集相关信息
        relevant_info = self._collect_relevant_info(
            section.topic, search_results, analysis_results
        )
        
        prompt = f"""请撰写研究报告的以下章节：

章节标题：{section.title}
章节主题：{section.topic}

相关信息：
{relevant_info}

要求：
1. 内容详实，有数据支撑
2. 逻辑清晰，论证有力
3. 引用来源
4. 字数500-800字"""
        
        return await self.llm.ainvoke(prompt)
```

## 完整的研究流程

```python
# deepscope/pipeline.py
class DeepScopePipeline:
    """DeepScope完整流程"""
    
    def __init__(self):
        self.llm = ChatOpenAI(model="gpt-4")
        self.coordinator = ResearchCoordinator(self.llm)
        self.search_agent = SearchAgent(self.llm, WebSearchTool(), WebFetchTool())
        self.analysis_agent = AnalysisAgent(self.llm)
        self.writer_agent = WriterAgent(self.llm)
        self.scheduler = TaskScheduler(max_concurrent=3)
    
    async def research(self, query: str) -> str:
        """执行完整研究流程"""
        print(f"🔍 开始研究: {query}")
        print("=" * 50)
        
        # 第一步：创建研究计划
        print("\n📋 第一步: 创建研究计划...")
        plan = await self.coordinator.create_research_plan(query)
        print(f"   理解: {plan.understanding}")
        print(f"   子任务: {len(plan.subtasks)} 个")
        
        # 第二步：并行执行搜索
        print("\n🔎 第二步: 并行执行搜索任务...")
        search_tasks = [t for t in plan.subtasks if t.type == "search"]
        search_results = await self.scheduler.execute_tasks(
            search_tasks, self.search_agent
        )
        print(f"   完成 {len(search_results)} 个搜索任务")
        
        # 第三步：执行分析
        print("\n📊 第三步: 执行深度分析...")
        analysis_tasks = [t for t in plan.subtasks if t.type == "analysis"]
        analysis_results = await self.scheduler.execute_tasks(
            analysis_tasks, 
            lambda task: self.analysis_agent.analyze(search_results, task)
        )
        print(f"   完成 {len(analysis_results)} 个分析任务")
        
        # 第四步：生成报告
        print("\n📝 第四步: 生成研究报告...")
        report = await self.writer_agent.write_report(
            query, search_results, analysis_results
        )
        print("=" * 50)
        print("✅ 研究完成！")
        
        return report
```

## 实际使用示例

```python
# 使用
pipeline = DeepScopePipeline()

report = await pipeline.research("分析2024年AI Agent市场竞争格局")

print(report)
```

输出：

```
🔍 开始研究: 分析2024年AI Agent市场竞争格局
==================================================

📋 第一步: 创建研究计划...
   理解: 用户想了解AI Agent市场的整体竞争态势
   子任务: 4 个

🔎 第二步: 并行执行搜索任务...
   [搜索Agent] 生成 4 个搜索关键词
   [搜索Agent] 抓取 5 个网页
   [搜索Agent] 提取关键信息
   完成 4 个搜索任务

📊 第三步: 执行深度分析...
   [分析Agent] 现状分析
   [分析Agent] 趋势分析
   [分析Agent] 对比分析
   完成 3 个分析任务

📝 第四步: 生成研究报告...
==================================================
✅ 研究完成！

# 2024年AI Agent市场竞争格局分析

## 摘要
2024年，AI Agent市场呈现爆发式增长态势...

## 1. 市场现状
### 1.1 市场规模
据Gartner预测，到2024年底...

### 1.2 主要玩家
- **OpenAI**: ChatGPT + Function Calling
- **Anthropic**: Claude + Tool Use
- **Google**: Gemini + Extensions
...

## 2. 技术趋势
### 2.1 多Agent协作
多Agent系统成为主流架构...

### 2.2 工具调用标准化
OpenAI Function Calling成为事实标准...

## 3. 竞争格局分析
### 3.1 技术壁垒
...

### 3.2 生态竞争
...

## 4. 结论与建议
...

## 参考文献
1. [AI Agent市场报告](https://example.com/report1)
2. [OpenAI Function Calling文档](https://platform.openai.com/docs)
...
```

## 优化策略

### 1. 缓存搜索结果

```python
class CachedSearchAgent(SearchAgent):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.cache = {}
    
    async def search(self, task: SearchTask) -> SearchResult:
        cache_key = task.description
        if cache_key in self.cache:
            return self.cache[cache_key]
        
        result = await super().search(task)
        self.cache[cache_key] = result
        return result
```

### 2. 增量研究

```python
class IncrementalResearcher:
    """增量研究：基于已有报告补充新信息"""
    
    async def update_report(self, existing_report: str, new_query: str) -> str:
        # 1. 分析已有报告
        gaps = await self._find_gaps(existing_report)
        
        # 2. 搜索新信息
        new_info = await self._search_new(gaps)
        
        # 3. 更新报告
        updated = await self._merge_report(existing_report, new_info)
        
        return updated
```

## 总结

DeepScope的核心组件：

| 组件 | 作用 | 关键特性 |
|------|------|---------|
| 协调器 | 任务分解与调度 | 智能分解，并行执行 |
| 搜索Agent | 信息搜集 | 多关键词，并行搜索 |
| 分析Agent | 深度分析 | 多维度，结构化 |
| 写作Agent | 报告生成 | 专业格式，引用标注 |
| 调度器 | 任务管理 | 并发控制，错误处理 |

## 参考资料

- [LangGraph多Agent教程](https://langchain-ai.github.io/langgraph/tutorials/multi_agent/)
- [AutoGen框架](https://github.com/microsoft/autogen)
- [Perplexity AI](https://www.perplexity.ai/)

---

*研究自动化的未来已经到来。让AI帮你做研究，你只需要提出问题。*

tags: multi-agent, research-automation, langgraph, deepscope, python
series: multi-agent-systems
