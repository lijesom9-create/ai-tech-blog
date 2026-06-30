# 深入Agent Loop：从单次调用到多步推理的完整实现

> 本文深入解析Agent Loop的高级特性，包括任务分解、并行子Agent、自动修复、Hooks系统等。基于CodeLite项目的实际实现，结合LangGraph的官方架构，带你理解Agent如何处理复杂任务。

## 前言

上一篇文章我们实现了Agent Loop的基础版——单次工具调用循环。但现实世界的任务远比"读文件、写代码"复杂。

比如这个任务：

```
"帮我分析这个项目的代码质量，找出潜在的安全漏洞，生成测试报告，然后推送到GitHub"
```

一个简单的Agent Loop会懵：这任务太大了，一步完不成。怎么办？

**答案：让Agent学会"拆解任务"和"分工协作"。**

## 任务规划器：让AI学会拆解任务

### 核心思路

当用户给出复杂任务时，Agent需要：
1. **理解任务** — 分析用户的真正意图
2. **制定计划** — 将大任务拆解为小步骤
3. **顺序执行** — 按计划逐步完成
4. **动态调整** — 根据执行结果调整计划

```python
# planner.py
from dataclasses import dataclass
from enum import Enum

class StepStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"

@dataclass
class PlanStep:
    id: int
    description: str
    status: StepStatus = StepStatus.PENDING
    result: str = None

class TaskPlanner:
    def __init__(self, llm):
        self.llm = llm
        self.steps = []
        self.current_step = 0
    
    def create_plan(self, goal: str) -> list[PlanStep]:
        """用LLM生成任务计划"""
        prompt = f"""请将以下任务拆解为可执行的步骤：

任务：{goal}

要求：
1. 每个步骤应该是单一、明确的操作
2. 步骤之间有清晰的依赖关系
3. 最多拆解为10个步骤

请返回JSON格式的步骤列表。"""
        
        response = self.llm.chat([{"role": "user", "content": prompt}])
        steps_data = json.loads(response)
        
        self.steps = [
            PlanStep(id=i, description=step["description"])
            for i, step in enumerate(steps_data["steps"])
        ]
        return self.steps
    
    def execute_next(self, agent_turn) -> str:
        """执行下一个步骤"""
        if self.current_step >= len(self.steps):
            return "所有步骤已完成"
        
        step = self.steps[self.current_step]
        step.status = StepStatus.RUNNING
        
        # 调用Agent执行这一步
        result = agent_turn(step.description)
        
        if result.startswith("Error"):
            step.status = StepStatus.FAILED
        else:
            step.status = StepStatus.COMPLETED
            step.result = result
        
        self.current_step += 1
        return result
```

### 实际效果

```
You> 帮我分析这个项目，找出安全漏洞，生成测试报告

📋 任务计划:
1. [ ] 扫描项目结构，了解代码组织
2. [ ] 检查依赖项安全漏洞
3. [ ] 分析代码中的潜在安全问题
4. [ ] 运行现有测试，检查覆盖率
5. [ ] 生成测试报告
6. [ ] 汇总分析结果

⏳ 步骤1: 扫描项目结构...
🔧 Calling: tree_view(path=".", max_depth=3)
✅ 完成

⏳ 步骤2: 检查依赖项安全漏洞...
🔧 Calling: run_command(command="pip audit")
⚠️ 发现2个安全漏洞
...
```

## 并行子Agent：分工协作

### 为什么需要并行？

有些任务可以并行执行，比如：
- 同时搜索多个关键词
- 同时分析多个文件
- 同时运行多个测试

串行执行太慢了。我们需要**子Agent系统**。

### 子Agent角色设计

CodeLite定义了5种专业子Agent角色：

```python
# agents.py
SUBAGENT_ROLES = {
    "explorer": {
        "name": "探索者",
        "description": "快速浏览项目结构，找出关键文件",
        "tools": ["list_dir", "read_file", "find_files"],
        "temperature": 0.3
    },
    "reviewer": {
        "name": "审查者",
        "description": "仔细审查代码，找出问题",
        "tools": ["read_file", "search_code"],
        "temperature": 0.2  # 低温度，严谨
    },
    "researcher": {
        "name": "研究者",
        "description": "搜索资料，查找文档",
        "tools": ["web_search", "web_fetch"],
        "temperature": 0.5
    },
    "planner": {
        "name": "规划者",
        "description": "制定计划，分解任务",
        "tools": [],
        "temperature": 0.7  # 高温度，创造性
    },
    "executor": {
        "name": "执行者",
        "description": "执行具体操作，写代码、运行命令",
        "tools": ["write_file", "edit_file", "run_command"],
        "temperature": 0.3
    }
}
```

### 并行执行引擎

```python
# tools_extra.py
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

def spawn_parallel(tasks: list[dict]) -> list[dict]:
    """并行执行多个子Agent任务
    
    Args:
        tasks: [{"role": "explorer", "task": "分析src目录"}, ...]
    
    Returns:
        [{"role": "explorer", "result": "..."}, ...]
    """
    results = []
    file_lock = FileLockManager()  # 文件锁，防止并发写入冲突
    
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {}
        for task in tasks:
            role = task["role"]
            prompt = task["task"]
            
            future = executor.submit(
                run_subagent, role, prompt, file_lock
            )
            futures[future] = role
        
        # 收集结果
        for future in as_completed(futures):
            role = futures[future]
            try:
                result = future.result(timeout=120)
                results.append({"role": role, "result": result})
            except Exception as e:
                results.append({"role": role, "result": f"Error: {e}"})
    
    return results


def run_subagent(role: str, task: str, file_lock: FileLockManager) -> str:
    """运行单个子Agent"""
    role_config = SUBAGENT_ROLES[role]
    
    system_prompt = f"""你是一个{role_config['name']}。
职责：{role_config['description']}

请专注于你的任务：{task}"""
    
    # 创建独立的LLM客户端
    llm = LLMClient(
        temperature=role_config["temperature"]
    )
    
    # 创建独立的上下文
    ctx = ConversationContext()
    ctx.add_system(system_prompt)
    
    # 运行Agent
    return run_agent_turn(task, ctx, llm, auto_approve=True)
```

### 文件锁机制

并行执行最怕的就是文件冲突。CodeLite用文件锁解决：

```python
# file_lock.py
import threading

class FileLockManager:
    def __init__(self):
        self._locks = {}
        self._lock = threading.Lock()
    
    def acquire(self, filepath: str, timeout: float = 30.0) -> bool:
        """获取文件锁"""
        with self._lock:
            if filepath not in self._locks:
                self._locks[filepath] = threading.Lock()
            lock = self._locks[filepath]
        
        return lock.acquire(timeout=timeout)
    
    def release(self, filepath: str):
        """释放文件锁"""
        with self._lock:
            if filepath in self._locks:
                self._locks[filepath].release()
    
    def __enter__(self):
        self.acquire(self.filepath)
        return self
    
    def __exit__(self, *args):
        self.release(self.filepath)
```

## 自动修复：命令失败时的智能重试

### 错误分析引擎

当命令执行失败时，Agent不应该傻傻地放弃，而应该**分析错误、尝试修复**：

```python
# autofix.py
ERROR_PATTERNS = {
    "ModuleNotFoundError": {
        "pattern": r"ModuleNotFoundError: No module named '(.+)'",
        "fix": "pip install {module}",
        "description": "缺少Python模块"
    },
    "FileNotFoundError": {
        "pattern": r"FileNotFoundError: \[Errno 2\] No such file or directory: '(.+)'",
        "fix": "检查文件路径是否正确",
        "description": "文件不存在"
    },
    "SyntaxError": {
        "pattern": r"SyntaxError: (.+)",
        "fix": "检查代码语法",
        "description": "语法错误"
    },
    "ConnectionError": {
        "pattern": r"ConnectionError: (.+)",
        "fix": "检查网络连接和API地址",
        "description": "网络连接失败"
    }
}

class RetryManager:
    def __init__(self, max_retries=3):
        self.max_retries = max_retries
        self.retry_count = {}
    
    def should_retry(self, command: str, error: str) -> tuple[bool, dict]:
        """判断是否应该重试，并返回修复建议"""
        key = f"{command}:{error[:50]}"
        count = self.retry_count.get(key, 0)
        
        if count >= self.max_retries:
            return False, {"reason": "超过最大重试次数"}
        
        self.retry_count[key] = count + 1
        
        # 分析错误类型
        for error_type, config in ERROR_PATTERNS.items():
            if error_type in error:
                match = re.search(config["pattern"], error)
                if match:
                    return True, {
                        "type": error_type,
                        "description": config["description"],
                        "fix": config["fix"].format(**match.groupdict()),
                        "suggestion": f"建议：{config['fix']}"
                    }
        
        return False, {"reason": "未知错误类型"}
```

### 实际效果

```
You> 运行项目测试
🔧 Calling: run_command(command="python -m pytest")
❌ FAILED - ModuleNotFoundError: No module named 'requests'

🔄 自动修复检测:
  错误类型: 缺少Python模块
  修复方案: pip install requests
  
🔧 Calling: run_command(command="pip install requests")
✅ 安装成功

🔧 Calling: run_command(command="python -m pytest")
✅ 所有测试通过 (15 passed, 0 failed)
```

## Hooks系统：生命周期控制

### 什么是Hooks？

Hooks是Agent的生命周期钩子，允许你在关键时刻插入自定义逻辑：

```python
# hooks.py
_hooks = {
    "pre_tool": [],      # 工具调用前
    "post_tool": [],     # 工具调用后
    "pre_response": [],  # 最终响应前
}

def register_hook(event: str, handler: Callable, priority: int = 0):
    """注册Hook"""
    _hooks[event].append({
        "handler": handler,
        "priority": priority
    })
    # 按优先级排序
    _hooks[event].sort(key=lambda x: x["priority"])


def run_pre_tool_hooks(tool_name: str, args: dict, work_dir: str):
    """运行工具调用前的Hooks"""
    for hook in _hooks["pre_tool"]:
        allowed, reason, modified_args = hook["handler"](
            tool_name, args, work_dir
        )
        if not allowed:
            return False, reason, None
        if modified_args:
            args = modified_args
    return True, None, args


# 示例：安全Hook - 禁止删除重要文件
@register_hook("pre_tool", priority=10)
def prevent_important_file_delete(tool_name, args, work_dir):
    """防止删除重要文件"""
    if tool_name == "run_command":
        cmd = args.get("command", "")
        important_files = [".git", "README.md", "LICENSE"]
        
        for f in important_files:
            if f in cmd and ("rm" in cmd or "del" in cmd):
                return False, f"禁止删除重要文件: {f}", None
    
    return True, None, args


# 示例：日志Hook - 记录所有工具调用
@register_hook("post_tool", priority=0)
def log_tool_call(tool_name, args, result, work_dir):
    """记录工具调用日志"""
    logger.info(f"Tool: {tool_name}, Args: {args}, Result: {result[:100]}")
    return result
```

### Hook应用场景

| Hook类型 | 应用场景 | 示例 |
|---------|---------|------|
| pre_tool | 安全检查、权限验证 | 禁止删除.git目录 |
| pre_tool | 参数修正 | 自动添加默认参数 |
| post_tool | 日志记录 | 记录所有工具调用 |
| post_tool | 结果后处理 | 自动格式化输出 |
| pre_response | 内容过滤 | 移除敏感信息 |
| pre_response | 格式化 | 添加Markdown格式 |

## 流式输出：实时反馈

### 为什么需要流式？

用户不想等Agent思考完才看到结果。流式输出让用户实时看到AI的思考过程：

```python
# llm.py - 流式输出实现
def chat_stream(self, messages, tools=None):
    """流式调用LLM"""
    payload = {
        "model": self.model,
        "messages": messages,
        "stream": True
    }
    
    if tools:
        payload["tools"] = tools
    
    response = requests.post(
        f"{self.api_base}/chat/completions",
        headers={"Authorization": f"Bearer {self.api_key}"},
        json=payload,
        stream=True
    )
    
    full_content = ""
    tool_calls = []
    
    for line in response.iter_lines():
        if line:
            # 解析SSE格式
            line_str = line.decode("utf-8")
            if line_str.startswith("data: "):
                data = line_str[6:]
                if data == "[DONE]":
                    break
                
                chunk = json.loads(data)
                delta = chunk["choices"][0]["delta"]
                
                # 处理文本内容
                if "content" in delta and delta["content"]:
                    full_content += delta["content"]
                    yield {"type": "content", "data": delta["content"]}
                
                # 处理工具调用
                if "tool_calls" in delta:
                    _merge_tool_calls(tool_calls, delta["tool_calls"])
                    yield {"type": "tool_call", "data": delta["tool_calls"]}
    
    yield {"type": "done", "content": full_content, "tool_calls": tool_calls}
```

### 渲染器：美化输出

```python
# renderer.py
class Renderer:
    def __init__(self):
        self.colors = {
            "tool_call": "\033[36m",   # 青色
            "tool_result": "\033[32m", # 绿色
            "error": "\033[31m",       # 红色
            "warning": "\033[33m",     # 黄色
            "reset": "\033[0m"
        }
    
    def tool_call(self, name, args):
        """显示工具调用"""
        print(f"{self.colors['tool_call']}🔧 Calling: {name}")
        for key, value in args.items():
            print(f"   {key}: {str(value)[:100]}")
        print(self.colors["reset"])
    
    def tool_result(self, result, is_error=False):
        """显示工具结果"""
        color = self.colors["error"] if is_error else self.colors["tool_result"]
        icon = "❌" if is_error else "✅"
        print(f"{color}{icon} {result[:200]}{self.colors['reset']}")
    
    def stream_token(self, token):
        """流式输出token"""
        print(token, end="", flush=True)
```

## 完整的Agent Loop

把所有组件组合起来，这就是完整的Agent Loop：

```python
def run_agent_turn(user_input, ctx, llm, auto_approve=False, 
                   planner=None, stream=True):
    """完整的Agent Loop"""
    ctx.add_user(user_input)
    retry_mgr = RetryManager(max_retries=3)
    
    for iteration in range(MAX_ITERATIONS):
        # 1. 上下文压缩
        ctx.maybe_compress()
        
        # 2. 调用LLM（流式）
        messages = ctx.get_messages()
        tool_defs = get_tool_definitions()
        
        if stream:
            response = {"content": "", "tool_calls": None}
            for chunk in llm.chat_stream(messages, tool_defs):
                if chunk["type"] == "content":
                    renderer.stream_token(chunk["data"])
                    response["content"] += chunk["data"]
                elif chunk["type"] == "tool_call":
                    response["tool_calls"] = chunk["data"]
        else:
            response = llm.chat(messages, tool_defs)
        
        content = response.get("content", "")
        tool_calls = response.get("tool_calls")
        ctx.add_assistant(content, tool_calls=tool_calls)
        
        # 3. 无工具调用 → 最终答案
        if not tool_calls:
            # 运行pre_response钩子
            content = hooks.run_pre_response_hooks(content, ctx.work_dir)
            return content
        
        # 4. 执行工具调用
        for tc in tool_calls:
            name = tc["function"]["name"]
            args = json.loads(tc["function"]["arguments"])
            
            # 4.1 运行pre_tool钩子
            allowed, reason, modified_args = hooks.run_pre_tool_hooks(
                name, args, ctx.work_dir
            )
            if not allowed:
                result = f"❌ 被Hook拦截: {reason}"
                ctx.add_tool_result(tc["id"], result)
                continue
            
            if modified_args:
                args = modified_args
            
            # 4.2 安全检查
            if is_dangerous(name):
                risk = classify_command(args.get("command", ""))
                if risk == "dangerous" and not auto_approve:
                    if not confirm(f"危险操作: {args}"):
                        result = "用户取消"
                        ctx.add_tool_result(tc["id"], result)
                        continue
            
            # 4.3 执行工具
            result = execute(name, args)
            
            # 4.4 自动修复
            is_error = result.startswith("Error") or result.startswith("❌")
            if is_error and name == "run_command":
                should_fix, analysis = retry_mgr.should_retry(
                    args.get("command"), result
                )
                if should_fix:
                    fix_cmd = analysis.get("fix")
                    result += f"\n💡 自动修复: {fix_cmd}"
                    result = execute("run_command", {"command": fix_cmd})
            
            # 4.5 运行post_tool钩子
            result = hooks.run_post_tool_hooks(name, args, result, ctx.work_dir)
            
            ctx.add_tool_result(tc["id"], result)
    
    return "达到最大迭代次数"
```

## 总结

一个生产级的Agent Loop需要这些组件：

| 组件 | 作用 | 关键设计 |
|------|------|---------|
| 任务规划器 | 拆解复杂任务 | LLM生成计划，动态调整 |
| 子Agent系统 | 分工协作 | 角色分工，并行执行 |
| 文件锁 | 防止并发冲突 | 细粒度锁，超时机制 |
| 自动修复 | 智能重试 | 错误模式匹配，建议修复 |
| Hooks系统 | 生命周期控制 | 可插拔，优先级排序 |
| 流式输出 | 实时反馈 | SSE解析，逐token输出 |

## 下一篇预告

> 《工具系统设计哲学：让AI拥有"双手"— 我们会探讨工具设计的艺术，包括如何选择工具粒度、处理工具依赖、优化工具调用效率等。

## 参考资料

- [LangGraph Agent架构](https://langchain-ai.github.io/langgraph/)
- [OpenAI Function Calling最佳实践](https://platform.openai.com/docs/guides/function-coding)
- [AutoGen多Agent框架](https://github.com/microsoft/autogen)

---

*本文基于开源项目CodeLite，完整源码见[GitHub](https://github.com/lijesom9-create/CodeLite)。*

tags: agent-loop, langgraph, multi-agent, python, architecture
series: ai-agent-development
