# 从零搭建AI编程助手：一个零依赖的Agent Loop实现

> 本文基于开源项目 [CodeLite](https://github.com/lijesom9-create/CodeLite)，深入解析如何用纯Python（零外部依赖）搭建一个完整的AI编程助手。我们会结合OpenAI Function Calling规范，手把手教你理解Agent的核心原理。

## 前言

2024年，AI编程助手成了开发者的新宠。Cursor、GitHub Copilot、Claude Code……这些工具背后都有一个核心概念：**Agent Loop**。

但大多数开源实现都依赖LangChain、LlamaIndex等重型框架。今天我们要做一个不一样的事：**用纯Python标准库，从零实现一个完整的AI编程助手**。

为什么？因为理解原理最好的方式，就是自己动手造一个。

## 最终效果

先看效果，再讲原理：

```
You> 帮我看看当前目录有什么文件
🔧 Calling: list_dir(path=".")
📄 结果: 找到 15 个文件...

You> 创建一个 hello.py，打印 Hello World
🔧 Calling: write_file(path="hello.py", content="print('Hello World')")
✅ 文件已写入

You> 运行它
🔧 Calling: run_command(command="python hello.py")
📤 输出: Hello World
```

看起来简单？背后的故事可不简单。

## Agent Loop：核心原理

### 什么是Agent Loop？

Agent Loop是AI Agent的核心循环，它让LLM能够：
1. **思考** — 分析用户需求
2. **决策** — 选择合适的工具
3. **执行** — 调用工具完成任务
4. **观察** — 获取执行结果
5. **循环** — 根据结果继续行动，直到完成任务

用伪代码表示：

```python
while True:
    response = llm.chat(messages, tools)
    
    if response.has_tool_calls():
        for tool_call in response.tool_calls:
            result = execute_tool(tool_call)
            messages.append(tool_result(result))
    else:
        return response.content  # 最终答案
```

### OpenAI Function Calling规范

Agent Loop的工具调用基于OpenAI的Function Calling规范。核心结构：

```json
{
    "tools": [
        {
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "读取文件内容",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "文件路径"
                        }
                    },
                    "required": ["path"]
                }
            }
        }
    ]
}
```

LLM返回时会带上`tool_calls`字段：

```json
{
    "choices": [{
        "message": {
            "content": null,
            "tool_calls": [{
                "id": "call_abc123",
                "type": "function",
                "function": {
                    "name": "read_file",
                    "arguments": "{\"path\": \"main.py\"}"
                }
            }]
        }
    }]
}
```

## 代码实现

### 1. 工具注册系统

工具注册是Agent的基础。我们用装饰器模式，让工具定义变得优雅：

```python
# tools.py
_registry = {}

def tool(name: str = None, description: str = "", dangerous: bool = False):
    """装饰器：注册一个工具"""
    def decorator(func):
        tool_name = name or func.__name__
        doc = description or func.__doc__.strip().split("\n")[0]
        
        # 从函数签名自动生成JSON Schema
        import inspect
        sig = inspect.signature(func)
        properties = {}
        required = []
        
        for param_name, param in sig.parameters.items():
            prop = {}
            hint = func.__annotations__.get(param_name)
            if hint is str:
                prop["type"] = "string"
            elif hint is int:
                prop["type"] = "integer"
            elif hint is bool:
                prop["type"] = "boolean"
            properties[param_name] = prop
            
            if param.default is inspect.Parameter.empty:
                required.append(param_name)
        
        schema = {
            "type": "object",
            "properties": properties,
            "required": required
        }
        
        _registry[tool_name] = {
            "name": tool_name,
            "description": doc,
            "parameters": schema,
            "handler": func,
            "dangerous": dangerous
        }
        return func
    return decorator


# 使用示例
@tool(description="读取文件内容")
def read_file(path: str) -> str:
    """读取指定路径的文件内容"""
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

@tool(description="执行Shell命令", dangerous=True)
def run_command(command: str) -> str:
    """执行Shell命令并返回输出"""
    import subprocess
    result = subprocess.run(command, shell=True, capture_output=True, text=True)
    return result.stdout or result.stderr
```

**设计亮点**：
- 装饰器模式：用`@tool`一行注册，干净利落
- 自动Schema生成：从函数签名+类型注解自动推断，不用手写JSON
- 危险标记：`dangerous=True`标记危险命令，后面安全层会用到

### 2. Agent Loop核心

这是整个系统的灵魂：

```python
# agent.py
MAX_ITERATIONS = 30  # 防止死循环

def run_agent_turn(user_input, ctx, llm, auto_approve=False):
    """运行一轮Agent对话"""
    ctx.add_user(user_input)
    
    for iteration in range(MAX_ITERATIONS):
        # 1. 上下文压缩（防止token超限）
        ctx.maybe_compress()
        
        # 2. 调用LLM
        messages = ctx.get_messages()
        tool_defs = get_tool_definitions()
        response = llm.chat(messages, tool_defs)
        
        content = response.get("content", "")
        tool_calls = response.get("tool_calls")
        ctx.add_assistant(content, tool_calls=tool_calls)
        
        # 3. 没有工具调用 → 最终答案
        if not tool_calls:
            return content
        
        # 4. 执行工具调用
        for tc in tool_calls:
            name = tc["function"]["name"]
            args = json.loads(tc["function"]["arguments"])
            
            # 4.1 安全检查
            if is_dangerous(name):
                risk = classify_command(args.get("command", ""))
                if risk == "dangerous" and not auto_approve:
                    if not confirm(f"危险操作: {args}，确认执行?"):
                        result = "用户取消了操作"
                        ctx.add_tool_result(tc["id"], result)
                        continue
            
            # 4.2 执行工具
            result = execute(name, args)
            
            # 4.3 自动修复（命令失败时）
            if result.startswith("Error"):
                fix_suggestion = analyze_error(args.get("command"), result)
                if fix_suggestion:
                    result += f"\n💡 建议: {fix_suggestion}"
            
            ctx.add_tool_result(tc["id"], result)
    
    return "达到最大迭代次数，请简化任务"
```

**关键设计点**：

1. **循环上限**：`MAX_ITERATIONS = 30`，防止LLM抽风陷入死循环
2. **上下文压缩**：token快满时自动摘要旧对话，保证长对话不断
3. **安全拦截**：危险命令需要用户确认
4. **自动修复**：命令失败时自动分析错误并建议修复

### 3. LLM客户端

支持OpenAI兼容API，一个客户端通吃所有Provider：

```python
# llm.py
class LLMClient:
    def __init__(self, provider, model, api_key, api_base):
        self.provider = provider
        self.model = model
        self.api_key = api_key
        self.api_base = api_base
    
    def chat(self, messages, tools=None, stream=True):
        """调用LLM，支持流式输出"""
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": stream
        }
        
        if tools:
            payload["tools"] = tools
        
        # 流式请求
        response = requests.post(
            f"{self.api_base}/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json=payload,
            stream=True
        )
        
        # 解析流式响应
        full_content = ""
        tool_calls = []
        
        for line in response.iter_lines():
            if line:
                chunk = json.loads(line.decode("utf-8").removeprefix("data: "))
                delta = chunk["choices"][0]["delta"]
                
                if "content" in delta:
                    full_content += delta["content"]
                    print(delta["content"], end="", flush=True)  # 实时输出
                
                if "tool_calls" in delta:
                    # 收集工具调用
                    _merge_tool_calls(tool_calls, delta["tool_calls"])
        
        return {"content": full_content, "tool_calls": tool_calls or None}
```

**兼容性**：因为用的是OpenAI兼容API格式，所以DashScope（通义千问）、DeepSeek、MiMo（小米）、Ollama（本地模型）都能直接用。

### 4. 安全层

安全是Agent系统的生命线：

```python
# safety.py
DANGER_PATTERNS = [
    r"\brm\s+(-[rf]+\s+|.*--recursive)",  # rm -rf
    r"\bformat\s+[a-zA-Z]:",               # format C:
    r"\bsudo\b",                            # sudo
    r"\bchmod\s+777",                       # chmod 777
    r"\bcurl\b.*\|\s*sh",                   # curl | sh
]

CONFIRM_PATTERNS = [
    r"\bgit\s+(commit|push|merge|rebase)",
    r"\bpip\s+install",
    r"\bnpm\s+install",
    r"\bdocker\s+(run|rm|stop)",
]

def classify_command(command: str) -> str:
    """命令风险分级"""
    for pattern in DANGER_PATTERNS:
        if re.search(pattern, command, re.IGNORECASE):
            return "dangerous"
    for pattern in CONFIRM_PATTERNS:
        if re.search(pattern, command, re.IGNORECASE):
            return "confirm"
    return "safe"
```

**三级风险**：
- 🟢 安全：直接执行（ls, cat, git status）
- 🟡 需确认：显示后确认（git push, pip install）
- 🔴 危险：双重确认（rm -rf, sudo）

### 5. 上下文管理

长对话的秘诀是智能压缩：

```python
# context.py
class ConversationContext:
    def __init__(self, max_tokens=30000):
        self.messages = []
        self.max_tokens = max_tokens
        self.project_snapshot = None
    
    def maybe_compress(self):
        """当token接近上限时，自动压缩"""
        total_tokens = self._count_tokens()
        
        if total_tokens > self.max_tokens * 0.8:
            # 保留最近5轮对话，其余摘要
            recent = self.messages[-10:]  # 最近10条消息
            old = self.messages[:-10]
            
            summary = self._summarize(old)
            self.messages = [
                {"role": "system", "content": f"之前的对话摘要:\n{summary}"}
            ] + recent
    
    def _summarize(self, messages):
        """用LLM摘要旧对话"""
        summary_prompt = "请简洁总结以下对话的关键信息：\n"
        for msg in messages:
            summary_prompt += f"{msg['role']}: {msg['content'][:200]}\n"
        
        return self.llm.chat([{"role": "user", "content": summary_prompt}])
```

## 实际使用效果

### 场景1：文件操作

```
You> 帮我看看项目结构
🔧 Calling: tree_view(path=".", max_depth=2)
📁 .
├── README.md
├── src/
│   ├── main.py
│   ├── utils.py
│   └── tests/
└── requirements.txt
```

### 场景2：代码重构

```
You> 把 utils.py 里的重复代码提取成函数
🔧 Calling: read_file(path="utils.py")
📄 读取完成，发现3处重复代码
🔧 Calling: edit_file(path="utils.py", old_text="...", new_text="...")
✅ 已重构，代码行数从150行减少到80行
```

### 场景3：自动修复

```
You> 运行测试
🔧 Calling: run_command(command="python -m pytest")
❌ FAILED - ModuleNotFoundError: No module named 'requests'
💡 建议: 检测到缺少依赖，运行 pip install requests
🔧 Calling: run_command(command="pip install requests")
✅ 安装完成
🔧 Calling: run_command(command="python -m pytest")
✅ 所有测试通过
```

## 对比LangChain实现

| 特性 | 纯Python实现 | LangChain Agent |
|------|-------------|-----------------|
| 依赖 | 零外部依赖 | 需要langchain+依赖 |
| 代码量 | ~500行 | 数千行 |
| 可控性 | 完全可控 | 框架封装 |
| 学习曲线 | 需理解原理 | API调用即可 |
| 灵活性 | 极高 | 受框架限制 |
| 性能 | 原生性能 | 有额外开销 |

**建议**：
- 学习原理 → 自己实现
- 生产环境 → 用LangChain/LangGraph
- 快速原型 → 用框架
- 深度定制 → 自己实现

## 总结

一个AI编程助手的核心组件：

1. **工具注册系统** — 让AI知道能做什么
2. **Agent Loop** — 让AI自主决策和执行
3. **LLM客户端** — 连接大模型的桥梁
4. **安全层** — 防止AI搞破坏
5. **上下文管理** — 维持长对话的连贯性

这5个组件，构成了AI Agent的最小可行架构。理解了它们，你就理解了所有AI Agent工具的底层原理。

## 下一篇预告

> 《深入Agent Loop：从单次调用到多步推理》— 我们会深入探讨Agent如何处理复杂任务，包括任务分解、并行执行、错误恢复等高级特性。

## 参考资料

- [OpenAI Function Calling文档](https://platform.openai.com/docs/guides/function-coding)
- [LangChain Agent架构](https://python.langchain.com/docs/modules/agents/)
- [CodeLite源码](https://github.com/lijesom9-create/CodeLite)

---

*本文基于开源项目CodeLite，代码已开源，欢迎Star和PR。*

tags: ai-agent, python, llm, agent-loop, developer-tools
series: ai-agent-development
