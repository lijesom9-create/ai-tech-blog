# 子Agent协作系统：让AI学会"分工合作"

> 一个人干不了的活，一群人可以。AI也一样。本文基于CodeLite和DeepScope的多Agent实现，结合AutoGen和CrewAI的设计理念，探讨如何构建高效的子Agent协作系统。

## 前言

假设你给AI一个复杂任务：

> "分析这个项目的代码质量，找出安全漏洞，生成测试报告，然后写一篇技术博客"

一个Agent独自处理？效率低，质量差。

如果能像人类团队一样分工：
- **探索者**：先浏览项目结构，找出关键文件
- **审查者**：仔细审查代码，找bug和安全漏洞
- **执行者**：运行测试，收集数据
- **作家**：最后根据分析结果写报告

这就是**多Agent协作系统**。

## 多Agent架构模式

### 模式1：主从模式（Master-Slave）

```
主Agent（协调者）
    ├── 子Agent 1（探索者）
    ├── 子Agent 2（审查者）
    ├── 子Agent 3（执行者）
    └── 子Agent 4（作家）
```

主Agent负责：
- 分解任务
- 分配子任务
- 收集结果
- 汇总输出

子Agent负责：
- 执行具体任务
- 返回结果给主Agent

### 模式2：对等模式（Peer-to-Peer）

```
Agent 1 ←→ Agent 2 ←→ Agent 3
    ↑           ↑           ↑
    └───── 共享上下文 ─────┘
```

所有Agent平等，通过共享上下文协作。

### 模式3：层级模式（Hierarchical）

```
总协调者
├── 研究组
│   ├── 搜索Agent
│   └── 分析Agent
├── 开发组
│   ├── 编码Agent
│   └── 测试Agent
└── 文档组
    ├── 写作Agent
    └── 审校Agent
```

适合超大型任务，多级分工。

## CodeLite的子Agent实现

### 角色定义

CodeLite定义了5种专业角色：

```python
# agents.py
SUBAGENT_ROLES = {
    "explorer": {
        "name": "探索者",
        "description": "快速浏览项目结构，找出关键文件和目录",
        "system_prompt": """你是一个项目探索专家。
你的任务是快速浏览项目结构，找出：
1. 项目的入口文件
2. 核心模块和它们的职责
3. 配置文件
4. 测试文件
5. 文档文件

输出格式：
📁 项目结构概览
├── 入口文件: xxx
├── 核心模块: xxx
├── 配置文件: xxx
└── 测试文件: xxx""",
        "tools": ["list_dir", "read_file", "find_files"],
        "temperature": 0.3,
        "max_iterations": 10
    },
    
    "reviewer": {
        "name": "审查者",
        "description": "仔细审查代码，找出问题和改进建议",
        "system_prompt": """你是一个代码审查专家。
你的任务是仔细审查代码，找出：
1. 潜在的bug
2. 安全漏洞
3. 性能问题
4. 代码风格问题
5. 可读性改进建议

审查原则：
- 给出具体的代码位置
- 说明问题原因
- 提供修复建议""",
        "tools": ["read_file", "search_code"],
        "temperature": 0.2,
        "max_iterations": 15
    },
    
    "researcher": {
        "name": "研究者",
        "description": "搜索资料，查找文档和解决方案",
        "system_prompt": """你是一个技术研究专家。
你的任务是：
1. 搜索相关技术文档
2. 查找最佳实践
3. 收集参考资料
4. 整理技术要点

输出格式：
📚 研究结果
├── 关键发现
├── 参考资料
└── 建议""",
        "tools": ["web_search", "web_fetch"],
        "temperature": 0.5,
        "max_iterations": 10
    },
    
    "planner": {
        "name": "规划者",
        "description": "制定计划，分解任务",
        "system_prompt": """你是一个任务规划专家。
你的任务是：
1. 理解任务目标
2. 分解为可执行的步骤
3. 评估每个步骤的难度
4. 制定执行顺序

输出格式：
📋 任务计划
├── 目标: xxx
├── 步骤:
│   1. xxx
│   2. xxx
│   └── xxx
└── 预计时间: xxx""",
        "tools": [],
        "temperature": 0.7,
        "max_iterations": 5
    },
    
    "executor": {
        "name": "执行者",
        "description": "执行具体操作，写代码、运行命令",
        "system_prompt": """你是一个任务执行专家。
你的任务是：
1. 按照计划执行操作
2. 写代码、运行命令
3. 处理执行过程中的问题
4. 报告执行结果

执行原则：
- 先检查，后执行
- 遇到错误，尝试修复
- 记录关键操作""",
        "tools": ["write_file", "edit_file", "run_command"],
        "temperature": 0.3,
        "max_iterations": 20
    }
}
```

### 子Agent执行器

```python
# agents.py
class SubAgent:
    def __init__(self, role: str, llm: LLMClient):
        self.config = SUBAGENT_ROLES[role]
        self.llm = llm
        self.ctx = ConversationContext()
        
        # 设置系统提示
        self.ctx.add_system(self.config["system_prompt"])
    
    def run(self, task: str) -> str:
        """执行任务"""
        self.ctx.add_user(task)
        
        for i in range(self.config["max_iterations"]):
            # 调用LLM
            messages = self.ctx.get_messages()
            response = self.llm.chat(
                messages, 
                get_tool_definitions(),
                temperature=self.config["temperature"]
            )
            
            content = response.get("content", "")
            tool_calls = response.get("tool_calls")
            
            self.ctx.add_assistant(content, tool_calls=tool_calls)
            
            # 无工具调用 → 最终答案
            if not tool_calls:
                return content
            
            # 执行工具
            for tc in tool_calls:
                name = tc["function"]["name"]
                
                # 检查工具权限
                if name not in self.config["tools"]:
                    result = f"Error: 角色 {self.config['name']} 无权使用工具 {name}"
                else:
                    args = json.loads(tc["function"]["arguments"])
                    result = execute_tool(name, args)
                
                self.ctx.add_tool_result(tc["id"], result)
        
        return "达到最大迭代次数"
```

### 并行执行引擎

```python
# parallel.py
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

class ParallelExecutor:
    def __init__(self, max_workers: int = 3):
        self.max_workers = max_workers
        self.file_lock = FileLockManager()
    
    def execute(self, tasks: list[dict]) -> list[dict]:
        """并行执行多个子Agent任务
        
        Args:
            tasks: [{"role": "explorer", "task": "分析src目录"}, ...]
        
        Returns:
            [{"role": "explorer", "result": "..."}, ...]
        """
        results = []
        
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            # 提交所有任务
            futures = {}
            for task in tasks:
                role = task["role"]
                prompt = task["task"]
                
                future = executor.submit(
                    self._run_subagent, role, prompt
                )
                futures[future] = role
            
            # 收集结果（按完成顺序）
            for future in as_completed(futures):
                role = futures[future]
                try:
                    result = future.result(timeout=120)
                    results.append({
                        "role": role,
                        "result": result,
                        "status": "success"
                    })
                except Exception as e:
                    results.append({
                        "role": role,
                        "result": str(e),
                        "status": "error"
                    })
        
        return results
    
    def _run_subagent(self, role: str, task: str) -> str:
        """运行单个子Agent"""
        agent = SubAgent(role, self.llm)
        return agent.run(task)
```

### 文件锁机制

并行执行时，多个Agent可能同时操作同一个文件。文件锁解决冲突：

```python
# file_lock.py
import threading

class FileLockManager:
    def __init__(self):
        self._locks = {}
        self._global_lock = threading.Lock()
    
    def acquire(self, filepath: str, timeout: float = 30.0) -> bool:
        """获取文件锁"""
        with self._global_lock:
            if filepath not in self._locks:
                self._locks[filepath] = threading.Lock()
            lock = self._locks[filepath]
        
        return lock.acquire(timeout=timeout)
    
    def release(self, filepath: str):
        """释放文件锁"""
        with self._global_lock:
            if filepath in self._locks:
                try:
                    self._locks[filepath].release()
                except RuntimeError:
                    pass  # 未锁定
    
    def with_lock(self, filepath: str, func, *args, **kwargs):
        """带锁执行函数"""
        if not self.acquire(filepath):
            return f"Error: 无法获取文件锁 {filepath}"
        
        try:
            return func(*args, **kwargs)
        finally:
            self.release(filepath)


# 使用示例
lock_manager = FileLockManager()

def safe_write_file(path: str, content: str) -> str:
    """带锁的文件写入"""
    return lock_manager.with_lock(path, _do_write_file, path, content)
```

## DeepScope的多Agent架构

### 研究协调器

DeepScope用一个协调器管理多个专业Agent：

```python
# coordinator.py
class ResearchCoordinator:
    def __init__(self):
        self.search_agent = SearchAgent()
        self.analysis_agent = AnalysisAgent()
        self.writer_agent = WriterAgent()
    
    async def research(self, query: str) -> ResearchReport:
        """执行研究任务"""
        # 1. 创建研究计划
        plan = await self._create_plan(query)
        
        # 2. 并行执行搜索任务
        search_results = await self._parallel_search(plan.search_tasks)
        
        # 3. 分析结果
        analysis = await self._analyze(search_results)
        
        # 4. 生成报告
        report = await self._write_report(query, analysis)
        
        return report
    
    async def _create_plan(self, query: str) -> ResearchPlan:
        """创建研究计划"""
        prompt = f"""请为以下研究问题制定计划：
{query}

要求：
1. 识别需要搜索的关键词
2. 识别需要分析的维度
3. 规划报告结构"""
        
        response = await self.llm.ainvoke(prompt)
        return parse_plan(response)
    
    async def _parallel_search(self, search_tasks: list) -> list:
        """并行执行搜索"""
        tasks = [
            self.search_agent.search(task)
            for task in search_tasks
        ]
        return await asyncio.gather(*tasks)
```

### 搜索Agent

```python
# search_agent.py
class SearchAgent:
    def __init__(self):
        self.llm = ChatOpenAI(model="gpt-4")
        self.tools = [WebSearchTool(), WebFetchTool()]
    
    async def search(self, task: SearchTask) -> SearchResult:
        """执行搜索任务"""
        results = []
        
        for query in task.queries:
            # 搜索网页
            search_results = await self.tools[0].arun(query)
            
            # 抓取内容
            for url in search_results[:3]:
                content = await self.tools[1].arun(url)
                results.append({
                    "url": url,
                    "content": content,
                    "query": query
                })
        
        return SearchResult(task=task, results=results)
```

### 分析Agent

```python
# analysis_agent.py
class AnalysisAgent:
    async def analyze(self, search_results: list) -> Analysis:
        """分析搜索结果"""
        prompt = f"""请分析以下研究结果，提取关键发现：

{format_results(search_results)}

分析维度：
1. 主要发现
2. 趋势分析
3. 数据支撑
4. 风险提示"""
        
        response = await self.llm.ainvoke(prompt)
        return parse_analysis(response)
```

## 实战：构建一个多Agent研究助手

### 完整流程

```python
# research_assistant.py
class ResearchAssistant:
    def __init__(self):
        self.coordinator = ResearchCoordinator()
        self.planner = TaskPlanner()
        self.searcher = SearchAgent()
        self.analyzer = AnalysisAgent()
        self.writer = WriterAgent()
    
    async def research(self, query: str) -> str:
        """完整的研究流程"""
        print(f"🔍 开始研究: {query}")
        
        # 第一步：制定计划
        print("📋 制定研究计划...")
        plan = await self.planner.create_plan(query)
        print(f"   计划包含 {len(plan.subtasks)} 个子任务")
        
        # 第二步：并行搜索
        print("🔎 并行执行搜索任务...")
        search_tasks = [
            {"role": "researcher", "task": subtask.description}
            for subtask in plan.subtasks
            if subtask.type == "search"
        ]
        search_results = await self.parallel_execute(search_tasks)
        
        # 第三步：分析结果
        print("📊 分析研究结果...")
        analysis = await self.analyzer.analyze(search_results)
        
        # 第四步：生成报告
        print("📝 生成研究报告...")
        report = await self.writer.write(query, analysis)
        
        print("✅ 研究完成！")
        return report
```

### 实际效果

```
🔍 开始研究: 分析2024年AI Agent市场竞争格局

📋 制定研究计划...
   计划包含 4 个子任务

🔎 并行执行搜索任务...
   [研究者] 搜索AI Agent市场规模...
   [研究者] 搜索主要玩家...
   [研究者] 搜索技术趋势...
   [研究者] 搜索投资动态...

📊 分析研究结果...
   [分析者] 提取关键发现...
   [分析者] 识别市场趋势...
   [分析者] 评估竞争格局...

📝 生成研究报告...
   [作家] 组织报告结构...
   [作家] 撰写详细分析...
   [作家] 添加数据支撑...

✅ 研究完成！

📄 报告预览：
# 2024年AI Agent市场竞争格局分析

## 摘要
2024年，AI Agent市场呈现爆发式增长...

## 主要玩家
1. OpenAI - ChatGPT + Function Calling
2. Anthropic - Claude + Tool Use
3. Google - Gemini + Extensions
...

## 技术趋势
- 多Agent协作成为主流
- 工具调用能力成为标配
- 安全性受到更多关注
...
```

## Agent通信协议

### 消息格式

```python
@dataclass
class AgentMessage:
    sender: str          # 发送者角色
    receiver: str        # 接收者角色
    content: str         # 消息内容
    message_type: str    # 消息类型：task, result, question, answer
    metadata: dict       # 元数据
    timestamp: datetime  # 时间戳
```

### 共享上下文

```python
class SharedContext:
    def __init__(self):
        self._data = {}
        self._lock = threading.Lock()
    
    def set(self, key: str, value: any):
        """设置共享数据"""
        with self._lock:
            self._data[key] = value
    
    def get(self, key: str, default=None) -> any:
        """获取共享数据"""
        with self._lock:
            return self._data.get(key, default)
    
    def append(self, key: str, value: any):
        """追加到列表"""
        with self._lock:
            if key not in self._data:
                self._data[key] = []
            self._data[key].append(value)

# 使用示例
shared = SharedContext()

# 搜索Agent写入结果
shared.append("search_results", result)

# 分析Agent读取结果
results = shared.get("search_results", [])
```

## 错误处理与容错

### 重试机制

```python
def execute_with_retry(agent, task, max_retries=3):
    """带重试的任务执行"""
    for attempt in range(max_retries):
        try:
            result = agent.run(task)
            return result
        except Exception as e:
            if attempt < max_retries - 1:
                print(f"⚠️ 任务失败，重试 {attempt + 1}/{max_retries}")
                time.sleep(2 ** attempt)  # 指数退避
            else:
                return f"Error: 任务失败 - {e}"
```

### 降级策略

```python
def execute_with_fallback(primary_agent, fallback_agent, task):
    """主Agent失败时，降级到备选Agent"""
    try:
        return primary_agent.run(task)
    except Exception as e:
        print(f"⚠️ 主Agent失败，降级到备选Agent")
        return fallback_agent.run(task)
```

## 总结

多Agent协作系统的核心组件：

| 组件 | 作用 | 关键设计 |
|------|------|---------|
| 角色定义 | 专业分工 | 系统提示、工具权限、温度参数 |
| 并行执行 | 提高效率 | 线程池、文件锁 |
| 通信协议 | Agent间通信 | 消息格式、共享上下文 |
| 协调器 | 任务调度 | 计划制定、任务分配、结果聚合 |
| 错误处理 | 容错机制 | 重试、降级、超时 |

## 下一篇预告

> 《RAG知识库实战：LangGraph + ChromaDB从零搭建》— 我们会深入RAG系统的核心实现，包括文档处理、向量检索、混合检索等。

## 参考资料

- [AutoGen多Agent框架](https://github.com/microsoft/autogen)
- [CrewAI多Agent框架](https://github.com/joaomdmoura/crewai)
- [LangGraph多Agent教程](https://langchain-ai.github.io/langgraph/tutorials/multi_agent/)

---

*多Agent协作是AI Agent的未来方向。一个人干不了的活，一群AI可以。*

tags: multi-agent, agent-collaboration, python, architecture
series: ai-agent-development
