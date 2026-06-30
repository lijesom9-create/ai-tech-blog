# LangGraph Agent开发指南：构建有状态的AI工作流

> LangGraph是LangChain团队推出的新框架，专门用于构建有状态、可循环的AI Agent。本文基于education-agent的LangGraph实现，带你深入理解LangGraph的核心概念和实战技巧。

## 前言

LangChain很强大，但有个问题：**它不擅长处理循环和条件分支**。

现实世界的Agent需要：
- 根据结果决定下一步
- 循环执行直到满足条件
- 在多个Agent之间协作

这就是LangGraph要解决的问题。

## LangGraph核心概念

### 图（Graph）

LangGraph的核心是**有向图**：

```python
from langgraph.graph import StateGraph

# 创建状态图
workflow = StateGraph(AgentState)
```

### 节点（Node）

节点是图中的处理单元：

```python
def agent_node(state: AgentState):
    """Agent节点"""
    response = llm.invoke(state["messages"])
    return {"messages": [response]}

def tool_node(state: AgentState):
    """工具节点"""
    # 执行工具调用
    results = []
    for tool_call in state["messages"][-1].tool_calls:
        result = tools[tool_call["name"]].invoke(tool_call["args"])
        results.append(result)
    return {"messages": results}

# 添加节点
workflow.add_node("agent", agent_node)
workflow.add_node("tools", tool_node)
```

### 边（Edge）

边定义节点之间的连接：

```python
# 普通边
workflow.add_edge("agent", "tools")

# 条件边
def should_continue(state: AgentState):
    """决定是否继续"""
    if state["messages"][-1].tool_calls:
        return "tools"
    return END

workflow.add_conditional_edges("agent", should_continue)
```

### 状态（State）

状态是节点之间传递的数据：

```python
from typing import TypedDict, Annotated
from operator import add

class AgentState(TypedDict):
    messages: Annotated[list, add]  # 消息列表，自动合并
    next_step: str                   # 下一步
```

## 完整的Agent实现

### 基础Agent

```python
# langgraph_agent/basic_agent.py
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage

class AgentState(TypedDict):
    messages: Annotated[list, add]

def create_basic_agent(tools: list):
    """创建基础Agent"""
    llm = ChatOpenAI(model="gpt-4").bind_tools(tools)
    
    # 定义节点
    def agent_node(state: AgentState):
        response = llm.invoke(state["messages"])
        return {"messages": [response]}
    
    def tool_node(state: AgentState):
        results = []
        for tool_call in state["messages"][-1].tool_calls:
            tool = next(t for t in tools if t.name == tool_call["name"])
            result = tool.invoke(tool_call["args"])
            results.append(ToolMessage(content=str(result), tool_call_id=tool_call["id"]))
        return {"messages": results}
    
    # 定义条件边
    def should_continue(state: AgentState):
        if state["messages"][-1].tool_calls:
            return "tools"
        return END
    
    # 构建图
    workflow = StateGraph(AgentState)
    workflow.add_node("agent", agent_node)
    workflow.add_node("tools", tool_node)
    
    workflow.set_entry_point("agent")
    workflow.add_conditional_edges("agent", should_continue)
    workflow.add_edge("tools", "agent")
    
    return workflow.compile()
```

### 带记忆的Agent

```python
# langgraph_agent/memory_agent.py
from langgraph.checkpoint.memory import MemorySaver

def create_memory_agent(tools: list):
    """创建带记忆的Agent"""
    agent = create_basic_agent(tools)
    
    # 添加检查点
    memory = MemorySaver()
    agent = agent.with_config({"checkpointer": memory})
    
    return agent

# 使用
agent = create_memory_agent(tools)

# 带thread_id的调用（持久化对话）
config = {"configurable": {"thread_id": "user_123"}}
result = agent.invoke({"messages": [HumanMessage(content="你好")]}, config)
```

## Education-Agent的LangGraph实现

### RAG Agent

```python
# langgraph_agent/rag_agent.py
from typing import TypedDict, Annotated, Literal
from langgraph.graph import StateGraph, END

class RAGState(TypedDict):
    question: str
    documents: list
    generation: str
    retrieval_needed: bool

def create_rag_agent(retriever, llm):
    """创建RAG Agent"""
    
    def retrieve(state: RAGState):
        """检索文档"""
        question = state["question"]
        documents = retriever.invoke(question)
        return {"documents": documents}
    
    def generate(state: RAGState):
        """生成答案"""
        question = state["question"]
        documents = state["documents"]
        
        prompt = f"""基于以下文档回答问题：

文档：{documents}

问题：{question}

要求：引用来源。"""
        
        generation = llm.invoke(prompt)
        return {"generation": generation}
    
    def grade_documents(state: RAGState):
        """评估文档相关性"""
        question = state["question"]
        documents = state["documents"]
        
        prompt = f"""评估以下文档是否与问题相关：

问题：{question}
文档：{documents}

返回：relevant 或 irrelevant"""
        
        grade = llm.invoke(prompt)
        return {"retrieval_needed": grade == "irrelevant"}
    
    def decide_next(state: RAGState):
        """决定下一步"""
        if state.get("retrieval_needed"):
            return "retrieve"
        return "generate"
    
    # 构建图
    workflow = StateGraph(RAGState)
    workflow.add_node("retrieve", retrieve)
    workflow.add_node("grade", grade_documents)
    workflow.add_node("generate", generate)
    
    workflow.set_entry_point("retrieve")
    workflow.add_edge("retrieve", "grade")
    workflow.add_conditional_edges("grade", decide_next)
    workflow.add_edge("generate", END)
    
    return workflow.compile()
```

### Multi-Agent协作

```python
# langgraph_agent/multi_agent.py
from langgraph.graph import StateGraph, END

class MultiAgentState(TypedDict):
    task: str
    current_agent: str
    results: dict
    messages: list

def create_multi_agent_system():
    """创建多Agent系统"""
    
    def coordinator(state: MultiAgentState):
        """协调者Agent"""
        task = state["task"]
        
        # 决定由哪个Agent处理
        prompt = f"""决定任务应该由哪个Agent处理：

任务：{task}

可选Agent：
- researcher: 研究和搜索
- coder: 编写代码
- reviewer: 代码审查

返回Agent名称。"""
        
        next_agent = llm.invoke(prompt)
        return {"current_agent": next_agent}
    
    def researcher(state: MultiAgentState):
        """研究Agent"""
        task = state["task"]
        # 执行研究任务
        result = research_task(task)
        return {"results": {"researcher": result}}
    
    def coder(state: MultiAgentState):
        """编码Agent"""
        task = state["task"]
        # 执行编码任务
        result = code_task(task)
        return {"results": {"coder": result}}
    
    def reviewer(state: MultiAgentState):
        """审查Agent"""
        task = state["task"]
        results = state["results"]
        # 审查结果
        review = review_task(task, results)
        return {"results": {"reviewer": review}}
    
    def route_agent(state: MultiAgentState):
        """路由到对应Agent"""
        return state["current_agent"]
    
    # 构建图
    workflow = StateGraph(MultiAgentState)
    workflow.add_node("coordinator", coordinator)
    workflow.add_node("researcher", researcher)
    workflow.add_node("coder", coder)
    workflow.add_node("reviewer", reviewer)
    
    workflow.set_entry_point("coordinator")
    workflow.add_conditional_edges("coordinator", route_agent)
    workflow.add_edge("researcher", END)
    workflow.add_edge("coder", END)
    workflow.add_edge("reviewer", END)
    
    return workflow.compile()
```

## 状态管理

### 状态定义

```python
from typing import TypedDict, Annotated, Union
from operator import add

class AgentState(TypedDict):
    # 消息列表（自动合并）
    messages: Annotated[list, add]
    
    # 当前步骤
    current_step: str
    
    # 中间结果
    intermediate_results: dict
    
    # 最终输出
    final_output: str
```

### 状态更新

```python
def update_state(state: AgentState, updates: dict) -> AgentState:
    """更新状态"""
    new_state = state.copy()
    
    for key, value in updates.items():
        if key == "messages":
            # 消息追加
            new_state["messages"] = state["messages"] + value
        else:
            # 其他字段覆盖
            new_state[key] = value
    
    return new_state
```

## 条件路由

### 基于状态的路由

```python
def route_based_on_state(state: AgentState) -> str:
    """基于状态决定路由"""
    if state.get("needs_search"):
        return "search_agent"
    elif state.get("needs_code"):
        return "code_agent"
    else:
        return END
```

### 基于LLM的路由

```python
def route_based_on_llm(state: AgentState) -> str:
    """用LLM决定路由"""
    task = state["task"]
    
    prompt = f"""决定任务类型：

任务：{task}

类型：
- search: 需要搜索信息
- code: 需要编写代码
- analysis: 需要分析数据

返回类型名称。"""
    
    task_type = llm.invoke(prompt)
    
    return {
        "search": "search_agent",
        "code": "code_agent",
        "analysis": "analysis_agent"
    }.get(task_type, END)
```

## 流式输出

```python
async def stream_agent(agent, input_data):
    """流式执行Agent"""
    async for event in agent.astream_events(input_data):
        kind = event["event"]
        
        if kind == "on_chat_model_stream":
            # 流式输出LLM响应
            content = event["data"]["chunk"].content
            print(content, end="", flush=True)
        
        elif kind == "on_tool_start":
            # 工具开始执行
            print(f"\n🔧 调用工具: {event['name']}")
        
        elif kind == "on_tool_end":
            # 工具执行完成
            print(f"✅ 工具结果: {event['data'].content[:100]}")
```

## 错误处理

```python
from langgraph.graph import StateGraph, END

def create_resilient_agent(tools: list):
    """创建有容错能力的Agent"""
    
    def agent_node(state: AgentState):
        try:
            response = llm.invoke(state["messages"])
            return {"messages": [response]}
        except Exception as e:
            return {"messages": [AIMessage(content=f"Error: {e}")]}
    
    def tool_node(state: AgentState):
        results = []
        for tool_call in state["messages"][-1].tool_calls:
            try:
                tool = next(t for t in tools if t.name == tool_call["name"])
                result = tool.invoke(tool_call["args"])
                results.append(ToolMessage(content=str(result), tool_call_id=tool_call["id"]))
            except Exception as e:
                results.append(ToolMessage(content=f"Error: {e}", tool_call_id=tool_call["id"]))
        return {"messages": results}
    
    def should_continue(state: AgentState):
        last_message = state["messages"][-1]
        
        # 检查是否有错误
        if "Error" in last_message.content:
            return "error_handler"
        
        # 检查是否有工具调用
        if hasattr(last_message, "tool_calls") and last_message.tool_calls:
            return "tools"
        
        return END
    
    def error_handler(state: AgentState):
        """错误处理"""
        error_msg = state["messages"][-1].content
        return {"messages": [AIMessage(content=f"遇到错误: {error_msg}，请重试。")]}
    
    # 构建图
    workflow = StateGraph(AgentState)
    workflow.add_node("agent", agent_node)
    workflow.add_node("tools", tool_node)
    workflow.add_node("error_handler", error_handler)
    
    workflow.set_entry_point("agent")
    workflow.add_conditional_edges("agent", should_continue)
    workflow.add_edge("tools", "agent")
    workflow.add_edge("error_handler", "agent")
    
    return workflow.compile()
```

## 实战：构建RAG + Agent系统

```python
# complete_rag_agent.py
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_community.tools import Tool

class RAGAgentState(TypedDict):
    question: str
    documents: list
    generation: str
    iterations: int

def create_complete_rag_agent(vector_store, llm):
    """创建完整的RAG Agent"""
    
    # 定义工具
    def search_docs(query: str) -> str:
        results = vector_store.search(query, top_k=3)
        return "\n".join([r["text"] for r in results])
    
    tools = [Tool(name="search_docs", func=search_docs, description="搜索文档")]
    
    # 定义节点
    def retrieve(state: RAGAgentState):
        question = state["question"]
        documents = search_docs(question)
        return {"documents": documents, "iterations": state.get("iterations", 0) + 1}
    
    def generate(state: RAGAgentState):
        question = state["question"]
        documents = state["documents"]
        
        prompt = f"""基于以下文档回答问题：

文档：{documents}

问题：{question}

如果文档不足以回答，请说明需要更多信息。"""
        
        generation = llm.invoke(prompt)
        return {"generation": generation}
    
    def should_continue(state: RAGAgentState):
        # 检查是否需要更多检索
        if "信息不足" in state["generation"] and state["iterations"] < 3:
            return "retrieve"
        return END
    
    # 构建图
    workflow = StateGraph(RAGAgentState)
    workflow.add_node("retrieve", retrieve)
    workflow.add_node("generate", generate)
    
    workflow.set_entry_point("retrieve")
    workflow.add_edge("retrieve", "generate")
    workflow.add_conditional_edges("generate", should_continue)
    
    return workflow.compile()
```

## 总结

LangGraph的核心优势：

| 特性 | 说明 | 应用场景 |
|------|------|---------|
| 有状态 | 节点间传递状态 | 多步推理 |
| 条件路由 | 动态决定下一步 | 智能决策 |
| 循环支持 | 支持循环执行 | 重试、迭代 |
| 检查点 | 状态持久化 | 长对话 |
| 流式输出 | 实时反馈 | 用户体验 |

## 参考资料

- [LangGraph官方文档](https://langchain-ai.github.io/langgraph/)
- [LangGraph教程](https://langchain-ai.github.io/langgraph/tutorials/)
- [LangGraph GitHub](https://github.com/langchain-ai/langgraph)

---

*LangGraph是构建复杂Agent的最佳选择。掌握了它，你就能构建真正智能的AI系统。*

tags: langgraph, agent, workflow, state-machine, python
series: rag-knowledge-system
