# 工具系统设计哲学：让AI拥有"双手"的艺术

> 工具是AI Agent的手脚。没有工具，LLM只是一个"嘴炮"——能说会道，但啥也干不了。本文基于三个开源项目的实践，结合OpenAI Tool Use规范，探讨工具系统设计的核心哲学。

## 前言

2024年，AI领域最大的进步是什么？

不是模型更大了，不是推理更快了，而是**AI学会使用工具了**。

从ChatGPT的Function Calling，到Claude的Tool Use，再到各种Agent框架的工具系统——工具让AI从"聊天机器人"进化成了"数字员工"。

但工具设计是一门艺术。设计得好，AI如虎添翼；设计得差，AI寸步难行。

## 工具设计的三个哲学

### 哲学1：工具是手，不是脑

工具应该做"脏活累活"，不要让工具做决策。

**反例**：
```python
@tool(description="分析代码质量并决定是否重构")
def analyze_and_refactor(code: str) -> str:
    # 工具里做了太多决策
    quality = assess_quality(code)
    if quality < 0.7:
        return refactor(code)
    return code
```

**正例**：
```python
@tool(description="分析代码质量，返回质量分数")
def analyze_quality(code: str) -> float:
    return assess_quality(code)

@tool(description="重构代码")
def refactor_code(code: str) -> str:
    return do_refactor(code)
```

**原则**：工具提供能力，Agent做决策。让AI来决定"是否重构"，而不是让工具自己决定。

### 哲学2：粒度适中，不粗不细

工具太粗 → AI无法精确控制
工具太细 → AI调用太多次，效率低下

**太粗的例子**：
```python
@tool(description="处理整个项目")
def process_project(project_path: str, action: str) -> str:
    # 一个工具包打天下，AI不知道怎么用
    pass
```

**太细的例子**：
```python
@tool(description="读取文件的第一行")
def read_first_line(path: str) -> str: ...

@tool(description="读取文件的第二行")
def read_second_line(path: str) -> str: ...

# 太细了，AI要调用几百次
```

**适中的粒度**：
```python
@tool(description="读取文件内容，支持指定行范围")
def read_file(path: str, start_line: int = None, end_line: int = None) -> str:
    """读取文件，可选指定行范围"""
    pass
```

### 哲学3：描述即文档

工具的description是AI理解工具的唯一途径。好的描述 = 好的工具使用。

**糟糕的描述**：
```python
@tool(description="处理文件")
def process_file(path: str) -> str: ...
```

**好的描述**：
```python
@tool(description="读取文件内容并返回。支持UTF-8和GBK编码。如果文件不存在，返回错误信息。")
def read_file(path: str) -> str:
    """
    读取指定路径的文件内容。
    
    参数：
        path: 文件的相对或绝对路径
    
    返回：
        文件内容的字符串，或错误信息
    
    示例：
        read_file("src/main.py") → 返回main.py的内容
    """
    pass
```

## 三个项目的工具系统对比

### 项目1：CodeLite的装饰器模式

CodeLite用Python装饰器实现工具注册，优雅且自动：

```python
# tools.py
_registry = {}

def tool(name=None, description="", dangerous=False):
    def decorator(func):
        tool_name = name or func.__name__
        
        # 从函数签名自动生成JSON Schema
        schema = generate_schema_from_signature(func)
        
        _registry[tool_name] = {
            "name": tool_name,
            "description": description,
            "parameters": schema,
            "handler": func,
            "dangerous": dangerous
        }
        return func
    return decorator

# 使用
@tool(description="读取文件内容")
def read_file(path: str) -> str:
    with open(path) as f:
        return f.read()
```

**优点**：代码即文档，自动Schema生成，开发效率高
**缺点**：Python特有，其他语言难以复用

### 项目2：Education-Agent的类注册模式

Education-Agent用类来组织工具，更结构化：

```python
# tools/base.py
class BaseTool:
    name: str
    description: str
    parameters: dict
    
    def execute(self, **kwargs) -> str:
        raise NotImplementedError

# tools/search.py
class SearchKnowledgeTool(BaseTool):
    name = "search_knowledge"
    description = "搜索知识库，返回相关文档片段"
    parameters = {
        "query": {"type": "string", "description": "搜索查询"},
        "top_k": {"type": "integer", "description": "返回结果数量", "default": 5}
    }
    
    def execute(self, query: str, top_k: int = 5) -> str:
        # 实现搜索逻辑
        results = self.vector_store.search(query, top_k=top_k)
        return format_results(results)

# 注册
tool_registry = ToolRegistry()
tool_registry.register(SearchKnowledgeTool())
tool_registry.register(WebSearchTool())
```

**优点**：结构清晰，易于测试和扩展
**缺点**：代码量较多，不够简洁

### 项目3：DeepScope的Schema驱动模式

DeepScope用JSON Schema定义工具，更接近OpenAI规范：

```python
# tools/definitions.py
TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "搜索互联网，获取最新信息",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词"
                    },
                    "num_results": {
                        "type": "integer",
                        "description": "返回结果数量",
                        "default": 5
                    }
                },
                "required": ["query"]
            }
        }
    }
]

# tools/executor.py
TOOL_HANDLERS = {
    "web_search": handle_web_search,
    "web_fetch": handle_web_fetch,
    "analyze_content": handle_analyze_content,
}

def execute_tool(name: str, args: dict) -> str:
    handler = TOOL_HANDLERS.get(name)
    if not handler:
        return f"Unknown tool: {name}"
    return handler(**args)
```

**优点**：与OpenAI规范完全一致，易于跨语言复用
**缺点**：Schema和实现分离，维护成本高

## 工具依赖管理

### 问题：工具之间有依赖

比如"推送到GitHub"依赖于"git add"和"git commit"：

```python
# 错误的方式：让AI自己按顺序调用
# AI可能会忘记先commit再push

# 正确的方式：用工具组合
@tool(description="提交并推送到GitHub")
def git_push(message: str) -> str:
    """自动add、commit、push"""
    run_command("git add .")
    run_command(f'git commit -m "{message}"')
    run_command("git push")
    return "推送成功"
```

### 工具组合模式

```python
class ToolChain:
    """工具链：按顺序执行多个工具"""
    def __init__(self):
        self.steps = []
    
    def add_step(self, tool_name: str, args: dict):
        self.steps.append((tool_name, args))
    
    def execute(self) -> list[str]:
        results = []
        for tool_name, args in self.steps:
            result = execute_tool(tool_name, args)
            results.append(result)
            
            # 如果某步失败，停止执行
            if result.startswith("Error"):
                break
        
        return results

# 预定义的工具链
git_push_chain = ToolChain()
git_push_chain.add_step("run_command", {"command": "git add ."})
git_push_chain.add_step("run_command", {"command": "git commit -m '{message}'"})
git_push_chain.add_step("run_command", {"command": "git push"})
```

## 工具错误处理

### 错误分类

```python
class ToolError(Exception):
    """工具错误基类"""
    pass

class ToolNotFoundError(ToolError):
    """工具不存在"""
    pass

class ToolPermissionError(ToolError):
    """权限不足"""
    pass

class ToolTimeoutError(ToolError):
    """执行超时"""
    pass

class ToolInputError(ToolError):
    """输入参数错误"""
    pass
```

### 错误恢复策略

```python
def execute_with_retry(tool_name: str, args: dict, max_retries: int = 3) -> str:
    """带重试的工具执行"""
    for attempt in range(max_retries):
        try:
            result = execute_tool(tool_name, args)
            return result
        except ToolTimeoutError:
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)  # 指数退避
                continue
            return "Error: 工具执行超时"
        except ToolInputError as e:
            return f"Error: 输入参数错误 - {e}"
        except ToolError as e:
            return f"Error: {e}"
    
    return "Error: 超过最大重试次数"
```

## 工具安全设计

### 三级权限模型

```python
class Permission(Enum):
    READ = "read"      # 只读操作
    WRITE = "write"    # 写操作
    EXECUTE = "execute" # 执行命令

TOOL_PERMISSIONS = {
    "read_file": Permission.READ,
    "list_dir": Permission.READ,
    "write_file": Permission.WRITE,
    "edit_file": Permission.WRITE,
    "run_command": Permission.EXECUTE,
    "git_push": Permission.EXECUTE,
}

def check_permission(tool_name: str, required: Permission) -> bool:
    """检查工具权限"""
    tool_perm = TOOL_PERMISSIONS.get(tool_name, Permission.READ)
    
    # 权限等级：READ < WRITE < EXECUTE
    levels = {Permission.READ: 0, Permission.WRITE: 1, Permission.EXECUTE: 2}
    return levels[tool_perm] <= levels[required]
```

### 沙箱执行

```python
def execute_in_sandbox(tool_name: str, args: dict, sandbox_dir: str) -> str:
    """在沙箱中执行工具"""
    # 限制文件操作范围
    if tool_name in ["read_file", "write_file", "edit_file"]:
        path = args.get("path", "")
        if not path.startswith(sandbox_dir):
            return "Error: 文件路径超出沙箱范围"
    
    # 限制命令执行
    if tool_name == "run_command":
        cmd = args.get("command", "")
        dangerous_commands = ["rm -rf", "format", "sudo"]
        for dc in dangerous_commands:
            if dc in cmd:
                return f"Error: 禁止执行危险命令: {dc}"
    
    return execute_tool(tool_name, args)
```

## 工具调用优化

### 批量调用

```python
def batch_execute(tool_calls: list[dict]) -> list[str]:
    """批量执行工具调用"""
    # 检查是否有依赖关系
    independent, dependent = separate_dependencies(tool_calls)
    
    # 独立的工具并行执行
    results = {}
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {
            executor.submit(execute_tool, tc["name"], tc["args"]): tc["id"]
            for tc in independent
        }
        for future in as_completed(futures):
            tc_id = futures[future]
            results[tc_id] = future.result()
    
    # 有依赖的工具顺序执行
    for tc in dependent:
        results[tc["id"]] = execute_tool(tc["name"], tc["args"])
    
    return results
```

### 工具结果缓存

```python
from functools import lru_cache

@lru_cache(maxsize=100)
def cached_read_file(path: str) -> str:
    """缓存文件读取结果"""
    with open(path) as f:
        return f.read()

def execute_with_cache(tool_name: str, args: dict) -> str:
    """带缓存的工具执行"""
    # 只读工具可以缓存
    if tool_name in ["read_file", "list_dir", "search_code"]:
        cache_key = f"{tool_name}:{json.dumps(args, sort_keys=True)}"
        if cache_key in _cache:
            return _cache[cache_key]
        
        result = execute_tool(tool_name, args)
        _cache[cache_key] = result
        return result
    
    # 写操作清除相关缓存
    if tool_name in ["write_file", "edit_file"]:
        clear_cache_for_file(args.get("path"))
    
    return execute_tool(tool_name, args)
```

## 实战：设计一个完整的工具系统

### 需求分析

一个AI编程助手需要这些工具：

| 类别 | 工具 | 用途 |
|------|------|------|
| 文件操作 | read_file, write_file, edit_file, apply_patch | 读写编辑文件 |
| 代码搜索 | search_code, find_files | 搜索代码 |
| 命令执行 | run_command | 运行Shell命令 |
| Git操作 | git_status, git_diff, git_log, git_push | Git操作 |
| Web工具 | web_search, web_fetch | 搜索和抓取网页 |
| Agent工具 | spawn_subagent, spawn_parallel | 子Agent |

### 完整实现

```python
# tools/registry.py
class ToolRegistry:
    def __init__(self):
        self._tools = {}
        self._categories = {}
    
    def register(self, name, handler, description="", 
                 parameters=None, dangerous=False, category="general"):
        """注册工具"""
        self._tools[name] = {
            "name": name,
            "handler": handler,
            "description": description,
            "parameters": parameters or {},
            "dangerous": dangerous,
            "category": category
        }
        
        if category not in self._categories:
            self._categories[category] = []
        self._categories[category].append(name)
    
    def execute(self, name, args):
        """执行工具"""
        tool = self._tools.get(name)
        if not tool:
            return f"Error: Unknown tool '{name}'"
        
        try:
            return tool["handler"](**args)
        except Exception as e:
            return f"Error executing {name}: {e}"
    
    def get_definitions(self):
        """获取所有工具定义（OpenAI格式）"""
        return [
            {
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t["description"],
                    "parameters": t["parameters"]
                }
            }
            for t in self._tools.values()
        ]
    
    def list_by_category(self, category):
        """列出某类别的工具"""
        return self._categories.get(category, [])


# 全局注册表
registry = ToolRegistry()

# 注册工具
registry.register(
    "read_file",
    handler=read_file,
    description="读取文件内容",
    parameters={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "文件路径"}
        },
        "required": ["path"]
    },
    category="file"
)
```

## 总结

工具系统设计的核心原则：

1. **工具是手，不是脑** — 提供能力，不做决策
2. **粒度适中** — 不粗不细，恰到好处
3. **描述即文档** — 好的描述 = 好的工具使用
4. **安全第一** — 权限控制，沙箱执行
5. **错误恢复** — 自动重试，智能修复
6. **性能优化** — 批量调用，结果缓存

## 下一篇预告

> 《Agent安全层设计：如何防止AI误删你的数据库》— 我们会深入探讨Agent系统的安全设计，包括命令分级、权限控制、审计日志等。

## 参考资料

- [OpenAI Tool Use文档](https://platform.openai.com/docs/guides/function-coding)
- [Anthropic Tool Use文档](https://docs.anthropic.com/claude/docs/tool-use)
- [OWASP AI安全指南](https://owasp.org/www-project-ai-security/)

---

*本文基于三个开源项目的实践，代码已开源。*

tags: tools, agent-design, python, architecture, security
series: ai-agent-development
