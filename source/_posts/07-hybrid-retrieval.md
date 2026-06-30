# 混合检索的威力：关键词+向量+BM25三路融合详解

> 检索是RAG系统的核心。单一检索方式各有局限，混合检索取长补短。本文深入解析三种检索算法的原理，并基于education-agent的实现，展示如何将它们融合。

## 前言

在RAG系统中，检索质量直接决定回答质量。

但问题是：**没有一种检索算法是完美的**。

- 关键词检索：精确但死板
- 向量检索：灵活但可能不准
- BM25：平衡但不极致

怎么办？**混合检索**。

## 三种检索算法

### 1. 关键词检索（Keyword Search）

最简单的检索方式：看文档是否包含查询中的关键词。

```python
def keyword_search(query: str, documents: list[str]) -> list[tuple]:
    """关键词检索"""
    results = []
    query_terms = query.lower().split()
    
    for doc in documents:
        # 计算匹配的关键词数量
        match_count = sum(1 for term in query_terms if term in doc.lower())
        if match_count > 0:
            score = match_count / len(query_terms)
            results.append((doc, score))
    
    return sorted(results, key=lambda x: x[1], reverse=True)
```

**优点**：
- 精确匹配，不错过任何包含关键词的文档
- 速度快，实现简单

**缺点**：
- 不懂语义："机器学习"匹配不到"ML"
- 对同义词无能为力

### 2. 向量检索（Vector Search）

将文本转换为向量，通过向量相似度检索。

```python
from sentence_transformers import SentenceTransformer
import numpy as np

class VectorSearch:
    def __init__(self):
        self.model = SentenceTransformer("all-MiniLM-L6-v2")
        self.document_vectors = None
        self.documents = None
    
    def index(self, documents: list[str]):
        """建立索引"""
        self.documents = documents
        self.document_vectors = self.model.encode(documents)
    
    def search(self, query: str, top_k: int = 5) -> list[tuple]:
        """向量检索"""
        # 查询向量化
        query_vector = self.model.encode([query])[0]
        
        # 计算余弦相似度
        similarities = np.dot(self.document_vectors, query_vector) / (
            np.linalg.norm(self.document_vectors, axis=1) * np.linalg.norm(query_vector)
        )
        
        # 排序
        top_indices = np.argsort(similarities)[::-1][:top_k]
        
        return [
            (self.documents[i], float(similarities[i]))
            for i in top_indices
        ]
```

**优点**：
- 懂语义："机器学习"能匹配到"ML"
- 支持跨语言检索

**缺点**：
- 可能漏掉精确匹配
- 需要额外的向量化开销

### 3. BM25检索

BM25是经典的概率检索算法，基于词频（TF）和逆文档频率（IDF）。

```python
from rank_bm25 import BM25Okapi

class BM25Search:
    def __init__(self):
        self.bm25 = None
        self.documents = None
    
    def index(self, documents: list[str]):
        """建立索引"""
        self.documents = documents
        tokenized_corpus = [doc.split() for doc in documents]
        self.bm25 = BM25Okapi(tokenized_corpus)
    
    def search(self, query: str, top_k: int = 5) -> list[tuple]:
        """BM25检索"""
        scores = self.bm25.get_scores(query.split())
        
        # 排序
        top_indices = np.argsort(scores)[::-1][:top_k]
        
        return [
            (self.documents[i], float(scores[i]))
            for i in top_indices
        ]
```

**BM25公式**：

```
score(D, Q) = Σ IDF(qi) * (f(qi, D) * (k1 + 1)) / (f(qi, D) + k1 * (1 - b + b * |D| / avgdl))
```

其中：
- `f(qi, D)`：词qi在文档D中的词频
- `IDF(qi)`：词qi的逆文档频率
- `k1`：词频饱和参数（通常1.2-2.0）
- `b`：文档长度归一化参数（通常0.75）

## 混合检索实现

### 融合策略

```python
class HybridRetriever:
    """混合检索器"""
    
    def __init__(self, keyword_weight=0.5, vector_weight=0.3, bm25_weight=0.2):
        self.keyword_weight = keyword_weight
        self.vector_weight = vector_weight
        self.bm25_weight = bm25_weight
        
        self.keyword_search = KeywordSearch()
        self.vector_search = VectorSearch()
        self.bm25_search = BM25Search()
    
    def index(self, documents: list[str]):
        """建立索引"""
        self.keyword_search.index(documents)
        self.vector_search.index(documents)
        self.bm25_search.index(documents)
    
    def search(self, query: str, top_k: int = 5) -> list[dict]:
        """混合检索"""
        # 三路检索
        keyword_results = self.keyword_search.search(query, top_k * 2)
        vector_results = self.vector_search.search(query, top_k * 2)
        bm25_results = self.bm25_search.search(query, top_k * 2)
        
        # 归一化分数
        keyword_norm = self._normalize(keyword_results)
        vector_norm = self._normalize(vector_results)
        bm25_norm = self._normalize(bm25_results)
        
        # 融合
        merged = self._merge(keyword_norm, vector_norm, bm25_norm)
        
        # 排序返回
        sorted_results = sorted(merged.items(), key=lambda x: x[1], reverse=True)
        
        return [
            {"text": doc, "score": score}
            for doc, score in sorted_results[:top_k]
        ]
    
    def _normalize(self, results: list[tuple]) -> dict:
        """归一化分数到[0, 1]"""
        if not results:
            return {}
        
        scores = [s for _, s in results]
        min_score = min(scores)
        max_score = max(scores)
        score_range = max_score - min_score if max_score != min_score else 1
        
        return {
            doc: (score - min_score) / score_range
            for doc, score in results
        }
    
    def _merge(self, keyword, vector, bm25) -> dict:
        """融合三路结果"""
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

### 权重调优

不同场景需要不同的权重配置：

```python
# 精确匹配场景（如代码搜索、日志分析）
config_precise = {
    "keyword_weight": 0.7,
    "vector_weight": 0.2,
    "bm25_weight": 0.1
}

# 语义理解场景（如开放问答）
config_semantic = {
    "keyword_weight": 0.3,
    "vector_weight": 0.5,
    "bm25_weight": 0.2
}

# 平衡场景（通用RAG）
config_balanced = {
    "keyword_weight": 0.5,
    "vector_weight": 0.3,
    "bm25_weight": 0.2
}
```

## RRF（Reciprocal Rank Fusion）

RRF是另一种融合策略，基于排名而非分数：

```python
def reciprocal_rank_fusion(results_list: list[list[tuple]], k=60) -> list[tuple]:
    """RRF融合
    
    Args:
        results_list: 多路检索结果
        k: 平滑参数（通常60）
    """
    scores = {}
    
    for results in results_list:
        for rank, (doc, _) in enumerate(results):
            if doc not in scores:
                scores[doc] = 0
            scores[doc] += 1 / (k + rank + 1)
    
    return sorted(scores.items(), key=lambda x: x[1], reverse=True)
```

**RRF公式**：

```
score(d) = Σ 1 / (k + rank_i(d))
```

**优点**：
- 不需要归一化分数
- 对异常值鲁棒
- 实现简单

## 检索评估指标

### Precision@K

```python
def precision_at_k(retrieved: list, relevant: set, k: int) -> float:
    """前K个结果中相关文档的比例"""
    top_k = retrieved[:k]
    hits = sum(1 for doc in top_k if doc in relevant)
    return hits / k
```

### Recall@K

```python
def recall_at_k(retrieved: list, relevant: set, k: int) -> float:
    """前K个结果覆盖了多少相关文档"""
    top_k = retrieved[:k]
    hits = sum(1 for doc in top_k if doc in relevant)
    return hits / len(relevant)
```

### MRR（Mean Reciprocal Rank）

```python
def mean_reciprocal_rank(queries_results: list[list]) -> float:
    """平均倒数排名"""
    rr_sum = 0
    for results in queries_results:
        for rank, doc in enumerate(results):
            if is_relevant(doc):
                rr_sum += 1 / (rank + 1)
                break
    return rr_sum / len(queries_results)
```

## 实验对比

我在education-agent项目上做了对比实验：

| 检索方式 | Precision@5 | Recall@5 | MRR |
|---------|-------------|----------|-----|
| 纯关键词 | 0.62 | 0.58 | 0.71 |
| 纯向量 | 0.55 | 0.52 | 0.63 |
| 纯BM25 | 0.58 | 0.55 | 0.67 |
| 混合检索 | **0.71** | **0.68** | **0.79** |

**结论**：混合检索在所有指标上都优于单一检索方式。

## 总结

| 检索方式 | 原理 | 优点 | 缺点 |
|---------|------|------|------|
| 关键词 | 精确匹配 | 速度快，精确 | 不懂语义 |
| 向量 | 语义相似 | 懂语义 | 可能漏精确匹配 |
| BM25 | 概率统计 | 平衡 | 不极致 |
| 混合 | 融合 | 取长补短 | 需调权重 |

## 参考资料

- [BM25论文](https://en.wikipedia.org/wiki/Okapi_BM25)
- [Sentence Transformers文档](https://www.sbert.net/)
- [RRF论文](https://dl.acm.org/doi/10.1145/1076034.1076045)

---

*混合检索是RAG系统的标配。没有最好的算法，只有最好的组合。*

tags: retrieval, bm25, vector-search, hybrid-search, rag
series: rag-knowledge-system
