# RAG知识库实战：LangGraph + ChromaDB从零搭建个人知识助手

> RAG（检索增强生成）是让AI拥有"外部记忆"的关键技术。本文基于education-agent项目的完整实现，结合LangChain官方最佳实践，手把手教你搭建一个支持文档上传、智能问答的个人知识库。

## 前言

你有没有遇到过这个问题：

> 问ChatGPT："我们公司的请假流程是什么？"
> ChatGPT："抱歉，我不知道你们公司的具体政策..."

为什么？因为大模型的知识是"冻结"在训练数据里的，它不知道你公司的内部文档。

**RAG（Retrieval-Augmented Generation）就是解决方案。**

简单说：先从你的文档里找到相关内容，再让AI基于这些内容回答问题。

## RAG架构概览

```
用户问题
    │
    ▼
┌─────────────────────────────────────┐
│           问题理解模块              │
│  • 意图识别                          │
│  • 问题改写                          │
│  • 子问题拆解                        │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│           检索模块                  │
│  • 关键词检索 (50%)                  │
│  • 向量检索 (30%)                    │
│  • BM25检索 (20%)                    │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│           重排序模块                │
│  • CrossEncoder重排序                │
│  • 去重、过滤                        │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│           生成模块                  │
│  • 基于检索结果生成答案              │
│  • 引用溯源                          │
└─────────────────────────────────────┘
```

## 文档处理Pipeline

### 第一步：文档解析

支持多种格式的文档：

```python
# document/parser.py
from pathlib import Path
import PyPDF2
from docx import Document

class DocumentParser:
    """文档解析器"""
    
    def parse(self, file_path: str) -> str:
        """解析文档，返回纯文本"""
        path = Path(file_path)
        suffix = path.suffix.lower()
        
        parsers = {
            ".pdf": self._parse_pdf,
            ".docx": self._parse_docx,
            ".txt": self._parse_txt,
            ".md": self._parse_markdown,
        }
        
        parser = parsers.get(suffix)
        if not parser:
            raise ValueError(f"不支持的文件格式: {suffix}")
        
        return parser(file_path)
    
    def _parse_pdf(self, path: str) -> str:
        """解析PDF"""
        with open(path, 'rb') as f:
            reader = PyPDF2.PdfReader(f)
            text = ""
            for page in reader.pages:
                text += page.extract_text() + "\n"
        return text
    
    def _parse_docx(self, path: str) -> str:
        """解析Word文档"""
        doc = Document(path)
        return "\n".join([para.text for para in doc.paragraphs])
    
    def _parse_txt(self, path: str) -> str:
        """解析纯文本"""
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()
    
    def _parse_markdown(self, path: str) -> str:
        """解析Markdown"""
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()
```

### 第二步：智能分块

分块是RAG的关键环节。分块不好，检索效果大打折扣。

```python
# document/chunker.py
class SmartChunker:
    """智能分块器"""
    
    def __init__(self, chunk_size=500, overlap=50):
        self.chunk_size = chunk_size
        self.overlap = overlap
    
    def chunk(self, text: str, metadata: dict = None) -> list[dict]:
        """智能分块"""
        # 先按段落分割
        paragraphs = text.split("\n\n")
        
        chunks = []
        current_chunk = ""
        
        for para in paragraphs:
            para = para.strip()
            if not para:
                continue
            
            # 如果当前块加上新段落超过限制，保存当前块
            if len(current_chunk) + len(para) > self.chunk_size:
                if current_chunk:
                    chunks.append(self._create_chunk(current_chunk, metadata))
                
                # 新块包含上一块的末尾（overlap）
                if self.overlap > 0 and current_chunk:
                    overlap_text = current_chunk[-self.overlap:]
                    current_chunk = overlap_text + "\n\n" + para
                else:
                    current_chunk = para
            else:
                current_chunk += "\n\n" + para if current_chunk else para
        
        # 保存最后一块
        if current_chunk:
            chunks.append(self._create_chunk(current_chunk, metadata))
        
        return chunks
    
    def _create_chunk(self, text: str, metadata: dict = None) -> dict:
        """创建块"""
        return {
            "text": text.strip(),
            "metadata": metadata or {},
            "length": len(text)
        }
```

### 第三步：向量化

```python
# document/embedder.py
from sentence_transformers import SentenceTransformer

class Embedder:
    """向量化器"""
    
    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        self.model = SentenceTransformer(model_name)
    
    def embed(self, texts: list[str]) -> list[list[float]]:
        """批量向量化"""
        return self.model.encode(texts).tolist()
    
    def embed_single(self, text: str) -> list[float]:
        """单条向量化"""
        return self.model.encode([text])[0].tolist()
```

### 第四步：存储到ChromaDB

```python
# vectorstore/chroma_store.py
import chromadb

class ChromaVectorStore:
    """ChromaDB向量存储"""
    
    def __init__(self, collection_name: str = "knowledge"):
        self.client = chromadb.PersistentClient(path="./chroma_db")
        self.collection = self.client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"}
        )
    
    def add_documents(self, chunks: list[dict], embeddings: list[list[float]]):
        """添加文档块"""
        ids = [f"doc_{i}" for i in range(len(chunks))]
        documents = [chunk["text"] for chunk in chunks]
        metadatas = [chunk["metadata"] for chunk in chunks]
        
        self.collection.add(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas
        )
    
    def search(self, query_embedding: list[float], top_k: int = 5) -> list[dict]:
        """向量检索"""
        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=top_k
        )
        
        return [
            {
                "text": doc,
                "score": score,
                "metadata": meta
            }
            for doc, score, meta in zip(
                results["documents"][0],
                results["distances"][0],
                results["metadatas"][0]
            )
        ]
```

## 混合检索策略

### 为什么需要混合检索？

单一检索方式有局限：
- **关键词检索**：精确匹配，但不懂语义
- **向量检索**：懂语义，但可能漏掉精确匹配
- **BM25检索**：统计方法，平衡但不极致

混合检索取长补短：

```python
# retrieval/hybrid_retriever.py
from rank_bm25 import BM25Okapi
import numpy as np

class HybridRetriever:
    """混合检索器"""
    
    def __init__(self, vector_store, keyword_weight=0.5, 
                 vector_weight=0.3, bm25_weight=0.2):
        self.vector_store = vector_store
        self.keyword_weight = keyword_weight
        self.vector_weight = vector_weight
        self.bm25_weight = bm25_weight
        
        # BM25索引
        self.bm25 = None
        self.corpus = []
    
    def build_index(self, documents: list[str]):
        """构建BM25索引"""
        self.corpus = documents
        tokenized_corpus = [doc.split() for doc in documents]
        self.bm25 = BM25Okapi(tokenized_corpus)
    
    def search(self, query: str, query_embedding: list[float], 
               top_k: int = 5) -> list[dict]:
        """混合检索"""
        # 1. 关键词检索
        keyword_results = self._keyword_search(query, top_k * 2)
        
        # 2. 向量检索
        vector_results = self._vector_search(query_embedding, top_k * 2)
        
        # 3. BM25检索
        bm25_results = self._bm25_search(query, top_k * 2)
        
        # 4. 融合分数
        merged = self._merge_scores(keyword_results, vector_results, bm25_results)
        
        # 5. 排序返回
        sorted_results = sorted(merged.items(), key=lambda x: x[1], reverse=True)
        
        return [
            {"text": doc, "score": score}
            for doc, score in sorted_results[:top_k]
        ]
    
    def _keyword_search(self, query: str, top_k: int) -> dict:
        """关键词检索"""
        results = {}
        query_terms = query.lower().split()
        
        for doc in self.corpus:
            score = sum(1 for term in query_terms if term in doc.lower())
            if score > 0:
                results[doc] = score / len(query_terms)
        
        return dict(sorted(results.items(), key=lambda x: x[1], reverse=True)[:top_k])
    
    def _vector_search(self, query_embedding: list[float], top_k: int) -> dict:
        """向量检索"""
        results = self.vector_store.search(query_embedding, top_k)
        return {r["text"]: 1 - r["score"] for r in results}  # 转换为相似度
    
    def _bm25_search(self, query: str, top_k: int) -> dict:
        """BM25检索"""
        if not self.bm25:
            return {}
        
        scores = self.bm25.get_scores(query.split())
        doc_scores = list(zip(self.corpus, scores))
        doc_scores.sort(key=lambda x: x[1], reverse=True)
        
        return {doc: score for doc, score in doc_scores[:top_k]}
    
    def _merge_scores(self, keyword, vector, bm25) -> dict:
        """融合分数"""
        all_docs = set(keyword.keys()) | set(vector.keys()) | set(bm25.keys())
        
        merged = {}
        for doc in all_docs:
            score = (
                keyword.get(doc, 0) * self.keyword_weight +
                vector.get(doc, 0) * self.vector_weight +
                bm25.get(doc, 0) * self.bm25_weight
            )
            merged[doc] = score
        
        return merged
```

## 重排序

### CrossEncoder重排序

```python
# retrieval/reranker.py
from sentence_transformers import CrossEncoder

class CrossEncoderReranker:
    """CrossEncoder重排序器"""
    
    def __init__(self, model_name: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"):
        self.model = CrossEncoder(model_name)
    
    def rerank(self, query: str, documents: list[dict], top_k: int = 3) -> list[dict]:
        """重排序"""
        # 构建查询-文档对
        pairs = [(query, doc["text"]) for doc in documents]
        
        # 计算相关性分数
        scores = self.model.predict(pairs)
        
        # 按分数排序
        scored_docs = list(zip(documents, scores))
        scored_docs.sort(key=lambda x: x[1], reverse=True)
        
        return [
            {**doc, "rerank_score": float(score)}
            for doc, score in scored_docs[:top_k]
        ]
```

## 问题理解

### 意图识别

```python
# retrieval/query_understanding.py
class QueryUnderstanding:
    """问题理解模块"""
    
    def __init__(self, llm):
        self.llm = llm
    
    async def understand(self, query: str) -> dict:
        """理解问题"""
        prompt = f"""请分析以下问题：

问题：{query}

请返回：
1. 意图类型（factual/how-to/comparison/opinion）
2. 关键实体
3. 改写后的查询（更适合检索的版本）
4. 是否需要拆解为子问题"""
        
        response = await self.llm.ainvoke(prompt)
        return parse_understanding(response)
    
    async def rewrite_query(self, query: str) -> str:
        """改写查询，更适合检索"""
        prompt = f"""请将以下问题改写为更适合搜索的版本：

原始问题：{query}

要求：
1. 去除口语化表达
2. 添加关键词
3. 保持原意"""
        
        response = await self.llm.ainvoke(prompt)
        return response.strip()
```

## 完整的RAG Pipeline

```python
# rag/pipeline.py
class RAGPipeline:
    """完整的RAG Pipeline"""
    
    def __init__(self):
        self.parser = DocumentParser()
        self.chunker = SmartChunker(chunk_size=500, overlap=50)
        self.embedder = Embedder()
        self.vector_store = ChromaVectorStore()
        self.retriever = HybridRetriever(self.vector_store)
        self.reranker = CrossEncoderReranker()
        self.query_understander = QueryUnderstanding(llm)
        self.llm = ChatOpenAI(model="gpt-4")
    
    async def ingest_document(self, file_path: str):
        """摄入文档"""
        print(f"📄 解析文档: {file_path}")
        text = self.parser.parse(file_path)
        
        print("✂️ 智能分块...")
        chunks = self.chunker.chunk(text, metadata={"source": file_path})
        
        print("🔢 向量化...")
        embeddings = self.embedder.embed([c["text"] for c in chunks])
        
        print("💾 存储到向量数据库...")
        self.vector_store.add_documents(chunks, embeddings)
        
        # 更新BM25索引
        self.retriever.build_index([c["text"] for c in chunks])
        
        print(f"✅ 完成！共处理 {len(chunks)} 个文档块")
    
    async def query(self, question: str) -> str:
        """查询"""
        # 1. 理解问题
        understanding = await self.query_understander.understand(question)
        rewritten_query = await self.query_understander.rewrite_query(question)
        
        # 2. 向量化查询
        query_embedding = self.embedder.embed_single(rewritten_query)
        
        # 3. 混合检索
        results = self.retriever.search(rewritten_query, query_embedding, top_k=10)
        
        # 4. 重排序
        reranked = self.reranker.rerank(question, results, top_k=3)
        
        # 5. 生成答案
        context = "\n\n".join([r["text"] for r in reranked])
        
        prompt = f"""基于以下参考资料回答问题。

参考资料：
{context}

问题：{question}

要求：
1. 基于参考资料回答，不要编造
2. 引用来源（标注来自哪个文档）
3. 如果参考资料不足以回答，说明需要更多信息"""
        
        answer = await self.llm.ainvoke(prompt)
        
        return {
            "answer": answer,
            "sources": [r["metadata"]["source"] for r in reranked],
            "confidence": sum(r["rerank_score"] for r in reranked) / len(reranked)
        }
```

## 实际使用

```python
# 使用示例
rag = RAGPipeline()

# 摄入文档
await rag.ingest_document("公司制度.pdf")
await rag.ingest_document("技术文档.md")
await rag.ingest_document("会议记录.docx")

# 查询
result = await rag.query("公司的请假流程是什么？")

print(result["answer"])
# 根据《公司制度.pdf》第3章规定：
# 1. 员工请假需提前3天申请
# 2. 3天以内由直属主管审批
# 3. 3天以上需部门经理审批
# ...

print(result["sources"])
# ['公司制度.pdf']

print(result["confidence"])
# 0.85
```

## 优化技巧

### 1. 分块大小选择

| 分块大小 | 适用场景 | 优点 | 缺点 |
|---------|---------|------|------|
| 200-300 | 精确问答 | 检索精确 | 可能丢失上下文 |
| 500-800 | 通用问答 | 平衡 | 适中 |
| 1000+ | 长文档理解 | 上下文完整 | 检索不够精确 |

### 2. 向量模型选择

| 模型 | 维度 | 特点 |
|------|------|------|
| all-MiniLM-L6-v2 | 384 | 速度快，效果好 |
| text-embedding-ada-002 | 1536 | OpenAI，效果最好 |
| bge-large-zh-v1.5 | 1024 | 中文优化 |

### 3. 检索权重调整

```python
# 根据场景调整权重
# 精确匹配场景（如代码搜索）
retriever = HybridRetriever(
    keyword_weight=0.7,  # 提高关键词权重
    vector_weight=0.2,
    bm25_weight=0.1
)

# 语义理解场景（如开放问答）
retriever = HybridRetriever(
    keyword_weight=0.3,
    vector_weight=0.5,  # 提高向量权重
    bm25_weight=0.2
)
```

## 总结

RAG系统的核心组件：

| 组件 | 作用 | 关键技术 |
|------|------|---------|
| 文档解析 | 多格式支持 | PyPDF2, python-docx |
| 智能分块 | 保留语义 | 按段落分块，overlap |
| 向量化 | 语义表示 | Sentence Transformers |
| 向量存储 | 高效检索 | ChromaDB |
| 混合检索 | 取长补短 | 关键词+向量+BM25 |
| 重排序 | 精排相关性 | CrossEncoder |
| 问题理解 | 优化查询 | 意图识别，查询改写 |

## 下一篇预告

> 《混合检索的威力：关键词+向量+BM25三路融合详解》— 我们会深入每种检索算法的原理，并对比它们的效果。

## 参考资料

- [LangChain RAG教程](https://python.langchain.com/docs/tutorials/rag/)
- [ChromaDB文档](https://docs.trychroma.com/)
- [Sentence Transformers文档](https://www.sbert.net/)

---

*RAG是让AI拥有"外部记忆"的关键技术。掌握了RAG，AI就不再是一个"失忆"的聊天机器人。*

tags: rag, langchain, chromadb, vector-search, python
series: rag-knowledge-system
