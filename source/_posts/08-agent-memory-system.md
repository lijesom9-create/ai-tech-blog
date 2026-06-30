# Agent记忆系统：让AI拥有长期记忆

> 人类有短期记忆和长期记忆，AI也需要。本文基于education-agent的记忆系统实现，结合MemGPT和Generative Agents论文，探讨如何为AI Agent构建记忆系统。

## 前言

你和ChatGPT聊天时，有没有这种感觉：

> "我上次不是告诉过你吗？"
> "我之前说的那个偏好你忘了？"

AI的"失忆"问题，源于它的记忆机制：**对话窗口就是它的全部记忆**。

窗口一关闭，记忆就消失。

## 记忆类型

### 人类记忆的三种类型

| 类型 | 持续时间 | 容量 | 例子 |
|------|---------|------|------|
| 感觉记忆 | 毫秒级 | 大 | 看到的图像 |
| 短期记忆 | 秒-分钟 | 7±2项 | 刚记住的电话号码 |
| 长期记忆 | 永久 | 无限 | 童年经历 |

### AI记忆的对应

| 人类记忆 | AI对应 | 实现方式 |
|---------|--------|---------|
| 感觉记忆 | 当前输入 | 用户当前消息 |
| 短期记忆 | 对话历史 | messages数组 |
| 长期记忆 | 外部存储 | 数据库、文件 |

## Education-Agent的记忆系统

### 架构设计

```
用户输入
    │
    ▼
┌─────────────────────────────────────┐
│           记忆管理器                │
│  ┌─────────────┐  ┌─────────────┐  │
│  │ 短期记忆    │  │ 长期记忆    │  │
│  │ (对话历史)  │  │ (用户画像)  │  │
│  └─────────────┘  └─────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  │
│  │ 档案记忆    │  │ 工作记忆    │  │
│  │ (历史记录)  │  │ (当前任务)  │  │
│  └─────────────┘  └─────────────┘  │
└─────────────────────────────────────┘
    │
    ▼
检索相关记忆 → 注入上下文 → LLM生成
```

### 记忆类型定义

```python
# memory/types.py
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

class MemoryType(Enum):
    SHORT_TERM = "short_term"      # 对话历史
    LONG_TERM = "long_term"        # 用户画像
    ARCHIVAL = "archival"          # 历史记录
    WORKING = "working"            # 当前任务上下文

@dataclass
class Memory:
    id: str
    content: str
    memory_type: MemoryType
    importance: float = 0.5        # 重要性分数 0-1
    created_at: datetime = field(default_factory=datetime.now)
    last_accessed: datetime = field(default_factory=datetime.now)
    access_count: int = 0
    metadata: dict = field(default_factory=dict)

@dataclass
class UserProfile:
    """用户画像"""
    preferences: dict = field(default_factory=dict)      # 偏好
    expertise_level: str = "intermediate"                 # 专业水平
    communication_style: str = "balanced"                 # 沟通风格
    interests: list = field(default_factory=list)         # 兴趣
    history_summary: str = ""                             # 历史摘要
```

### 记忆管理器

```python
# memory/manager.py
class MemoryManager:
    def __init__(self, db, llm):
        self.db = db
        self.llm = llm
        self.short_term = ShortTermMemory(max_tokens=4000)
        self.long_term = LongTermMemory(db)
        self.archival = ArchivalMemory(db)
        self.working = WorkingMemory()
    
    async def remember(self, content: str, memory_type: MemoryType, 
                       importance: float = 0.5, metadata: dict = None):
        """存储记忆"""
        memory = Memory(
            id=str(uuid.uuid4()),
            content=content,
            memory_type=memory_type,
            importance=importance,
            metadata=metadata or {}
        )
        
        if memory_type == MemoryType.SHORT_TERM:
            await self.short_term.add(memory)
        elif memory_type == MemoryType.LONG_TERM:
            await self.long_term.add(memory)
        elif memory_type == MemoryType.ARCHIVAL:
            await self.archival.add(memory)
    
    async def recall(self, query: str, memory_types: list[MemoryType] = None,
                     top_k: int = 5) -> list[Memory]:
        """检索记忆"""
        if memory_types is None:
            memory_types = [MemoryType.SHORT_TERM, MemoryType.LONG_TERM, MemoryType.ARCHIVAL]
        
        all_memories = []
        
        for mt in memory_types:
            if mt == MemoryType.SHORT_TERM:
                memories = await self.short_term.search(query, top_k)
            elif mt == MemoryType.LONG_TERM:
                memories = await self.long_term.search(query, top_k)
            elif mt == MemoryType.ARCHIVAL:
                memories = await self.archival.search(query, top_k)
            else:
                continue
            
            all_memories.extend(memories)
        
        # 按重要性和相关性排序
        all_memories.sort(key=lambda m: m.importance, reverse=True)
        return all_memories[:top_k]
    
    async def get_context(self, query: str) -> str:
        """获取上下文（注入到prompt）"""
        # 1. 获取相关记忆
        memories = await self.recall(query)
        
        # 2. 获取用户画像
        profile = await self.long_term.get_profile()
        
        # 3. 组装上下文
        context = f"""
## 用户画像
- 专业水平: {profile.expertise_level}
- 沟通风格: {profile.communication_style}
- 兴趣: {', '.join(profile.interests)}

## 相关记忆
"""
        for mem in memories:
            context += f"- {mem.content}\n"
        
        return context
```

### 短期记忆（对话历史）

```python
# memory/short_term.py
class ShortTermMemory:
    def __init__(self, max_tokens: int = 4000):
        self.messages = []
        self.max_tokens = max_tokens
    
    async def add(self, memory: Memory):
        """添加到对话历史"""
        self.messages.append(memory)
        
        # 超出限制时压缩
        if self._count_tokens() > self.max_tokens:
            await self._compress()
    
    async def search(self, query: str, top_k: int = 5) -> list[Memory]:
        """搜索对话历史"""
        # 简单实现：返回最近的消息
        return self.messages[-top_k:]
    
    async def _compress(self):
        """压缩对话历史"""
        # 保留最近10条，其余摘要
        recent = self.messages[-10:]
        old = self.messages[:-10]
        
        if old:
            summary = await self._summarize(old)
            self.messages = [
                Memory(content=f"之前的对话摘要: {summary}", 
                       memory_type=MemoryType.SHORT_TERM)
            ] + recent
    
    async def _summarize(self, messages: list[Memory]) -> str:
        """用LLM摘要"""
        text = "\n".join([m.content for m in messages])
        prompt = f"请简洁总结以下对话：\n{text}"
        return await self.llm.ainvoke(prompt)
```

### 长期记忆（用户画像）

```python
# memory/long_term.py
class LongTermMemory:
    def __init__(self, db):
        self.db = db
        self.profile = UserProfile()
    
    async def add(self, memory: Memory):
        """添加到长期记忆"""
        # 存储到数据库
        await self.db.memories.insert_one({
            "id": memory.id,
            "content": memory.content,
            "importance": memory.importance,
            "created_at": memory.created_at,
            "metadata": memory.metadata
        })
        
        # 更新用户画像
        await self._update_profile(memory)
    
    async def search(self, query: str, top_k: int = 5) -> list[Memory]:
        """搜索长期记忆"""
        # 向量检索
        results = await self.db.memories.aggregate([
            {
                "$vectorSearch": {
                    "query": query,
                    "path": "embedding",
                    "numCandidates": top_k * 10,
                    "limit": top_k
                }
            }
        ]).to_list()
        
        return [Memory(**r) for r in results]
    
    async def _update_profile(self, memory: Memory):
        """更新用户画像"""
        prompt = f"""根据以下信息更新用户画像：

当前画像: {self.profile}
新信息: {memory.content}

请更新用户的偏好、兴趣、专业水平等信息。"""
        
        updated = await self.llm.ainvoke(prompt)
        self.profile = parse_profile(updated)
    
    async def get_profile(self) -> UserProfile:
        """获取用户画像"""
        return self.profile
```

### 档案记忆

```python
# memory/archival.py
class ArchivalMemory:
    def __init__(self, db):
        self.db = db
    
    async def add(self, memory: Memory):
        """添加到档案"""
        # 向量化
        embedding = await self._embed(memory.content)
        
        await self.db.archival.insert_one({
            "id": memory.id,
            "content": memory.content,
            "embedding": embedding,
            "importance": memory.importance,
            "created_at": memory.created_at
        })
    
    async def search(self, query: str, top_k: int = 5) -> list[Memory]:
        """搜索档案"""
        query_embedding = await self._embed(query)
        
        results = await self.db.archival.aggregate([
            {
                "$vectorSearch": {
                    "query": query_embedding,
                    "path": "embedding",
                    "numCandidates": top_k * 10,
                    "limit": top_k
                }
            }
        ]).to_list()
        
        return [Memory(**r) for r in results]
```

## MemGPT的记忆架构

MemGPT提出了更复杂的记忆管理策略：

```python
# memgpt/agent.py
class MemGPTAgent:
    def __init__(self):
        self.main_memory = []      # 主记忆（类似人类的工作记忆）
        self.archival_memory = []  # 档案记忆（类似人类的长期记忆）
        self.recall_memory = []    # 回忆记忆（对话历史）
    
    async def step(self, user_input: str) -> str:
        """执行一步"""
        # 1. 检查主记忆是否需要刷新
        if self._is_memory_full():
            await self._flush_to_archival()
        
        # 2. 检索相关记忆
        relevant_memories = await self._search_memories(user_input)
        
        # 3. 注入上下文
        context = self._build_context(user_input, relevant_memories)
        
        # 4. 生成响应
        response = await self.llm.ainvoke(context)
        
        # 5. 存储到回忆记忆
        self.recall_memory.append({
            "user": user_input,
            "assistant": response
        })
        
        return response
    
    async def _flush_to_archival(self):
        """将主记忆刷新到档案"""
        # 用LLM决定哪些记忆重要，需要保留
        prompt = f"""决定以下记忆中哪些值得长期保存：

{self.main_memory}

返回值得保存的记忆ID列表。"""
        
        important_ids = await self.llm.ainvoke(prompt)
        
        # 重要的移到档案，不重要的丢弃
        for memory in self.main_memory:
            if memory["id"] in important_ids:
                self.archival_memory.append(memory)
        
        self.main_memory = []
```

## Generative Agents的记忆架构

来自Stanford的"Generative Agents"论文提出了更精细的记忆系统：

```python
# generative_agents/memory.py
class GenerativeAgentMemory:
    def __init__(self):
        self.memory_stream = []  # 记忆流
    
    async def add(self, observation: str, importance: float):
        """添加观察到记忆流"""
        memory = {
            "content": observation,
            "importance": importance,
            "created_at": datetime.now(),
            "last_accessed": datetime.now(),
            "access_count": 0,
            "embedding": await self._embed(observation)
        }
        self.memory_stream.append(memory)
    
    async def retrieve(self, query: str, top_k: int = 5) -> list:
        """检索记忆（考虑时间衰减和重要性）"""
        query_embedding = await self._embed(query)
        
        scored_memories = []
        for memory in self.memory_stream:
            # 计算相关性
            relevance = cosine_similarity(query_embedding, memory["embedding"])
            
            # 计算时间衰减
            time_decay = self._time_decay(memory["last_accessed"])
            
            # 计算重要性
            importance = memory["importance"]
            
            # 综合分数
            score = relevance * 0.5 + time_decay * 0.3 + importance * 0.2
            
            scored_memories.append((memory, score))
        
        # 排序返回
        scored_memories.sort(key=lambda x: x[1], reverse=True)
        return [m for m, _ in scored_memories[:top_k]]
    
    def _time_decay(self, last_accessed: datetime) -> float:
        """时间衰减函数"""
        hours_since = (datetime.now() - last_accessed).total_seconds() / 3600
        return 1 / (1 + hours_since)  # 反比例衰减
```

## 实战：构建记忆增强对话系统

```python
# memory_enhanced_chat.py
class MemoryEnhancedChat:
    def __init__(self):
        self.memory_manager = MemoryManager()
        self.llm = ChatOpenAI(model="gpt-4")
    
    async def chat(self, user_input: str) -> str:
        """带记忆的对话"""
        # 1. 检索相关记忆
        context = await self.memory_manager.get_context(user_input)
        
        # 2. 构建prompt
        prompt = f"""你是一个有记忆的AI助手。

{context}

用户输入：{user_input}

请基于你的记忆回答用户的问题。如果记忆中没有相关信息，请诚实说明。"""
        
        # 3. 生成响应
        response = await self.llm.ainvoke(prompt)
        
        # 4. 存储这次对话
        await self.memory_manager.remember(
            f"用户: {user_input}\n助手: {response}",
            MemoryType.SHORT_TERM
        )
        
        # 5. 提取重要信息存入长期记忆
        important_info = await self._extract_important(user_input, response)
        if important_info:
            await self.memory_manager.remember(
                important_info,
                MemoryType.LONG_TERM,
                importance=0.8
            )
        
        return response
```

## 总结

| 记忆类型 | 作用 | 存储位置 | 检索方式 |
|---------|------|---------|---------|
| 短期记忆 | 当前对话 | 内存 | 时间顺序 |
| 长期记忆 | 用户画像 | 数据库 | 向量检索 |
| 档案记忆 | 历史记录 | 数据库 | 向量检索 |
| 工作记忆 | 当前任务 | 内存 | 直接访问 |

## 参考资料

- [MemGPT论文](https://arxiv.org/abs/2310.08560)
- [Generative Agents论文](https://arxiv.org/abs/2304.03442)
- [LangChain Memory文档](https://python.langchain.com/docs/modules/memory/)

---

*记忆是AI个性化的基础。没有记忆的AI，每次对话都是第一次见面。*

tags: memory, memgpt, personalization, rag, python
series: rag-knowledge-system
