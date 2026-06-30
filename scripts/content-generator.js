#!/usr/bin/env node
/**
 * AI技术博客自动化内容生成器
 * 功能：爬取文档 → 分析 → 生成教程
 */

const fs = require('fs');
const path = require('path');

// 内容来源配置
const CONTENT_SOURCES = {
  llm: {
    name: '大语言模型',
    sources: [
      { url: 'https://huggingface.co/blog', type: 'huggingface' },
      { url: 'https://openai.com/blog', type: 'openai' },
      { url: 'https://www.langchain.com/blog', type: 'langchain' },
    ],
    tags: ['LLM', '大模型', 'Transformer', '微调']
  },
  agent: {
    name: 'AI Agent',
    sources: [
      { url: 'https://blog.langchain.dev', type: 'langchain' },
      { url: 'https://microsoft.github.io/autogen/blog', type: 'autogen' },
      { url: 'https://docs.crewai.com', type: 'crewai' },
    ],
    tags: ['Agent', 'LangChain', 'AutoGen', 'CrewAI']
  },
  rag: {
    name: 'RAG检索增强生成',
    sources: [
      { url: 'https://www.pinecone.io/learn/', type: 'pinecone' },
      { url: 'https://docs.trychromera.com', type: 'chroma' },
      { url: 'https://www.milvus.io/blog', type: 'milvus' },
    ],
    tags: ['RAG', '向量数据库', 'ChromaDB', 'Milvus']
  },
  tools: {
    name: 'AI工具评测',
    sources: [
      { url: 'https://github.com/trending', type: 'github' },
      { url: 'https://news.ycombinator.com', type: 'hn' },
    ],
    tags: ['工具', '开源', '评测']
  }
};

// 教程模板
const TUTORIAL_TEMPLATE = `---
title: {{title}}
date: {{date}}
tags:
{{tags}}
categories:
  - {{category}}
description: {{description}}
top_img: {{cover}}
cover: {{cover}}
---

# {{title}}

## 概述

{{overview}}

## 核心概念

{{concepts}}

## 实战代码

\`\`\`python
{{code_example}}
\`\`\`

## 最佳实践

{{best_practices}}

## 常见问题

{{faq}}

## 总结

{{summary}}

---

> 📚 **相关资源**
{{resources}}

---

*下期预告：{{next_topic}}*
`;

// 配置
const CONFIG = {
  outputDir: path.join(__dirname, '..', 'source', '_posts'),
  scheduleFile: path.join(__dirname, 'content-schedule.json'),
  logFile: path.join(__dirname, 'generation-log.json'),
};

/**
 * 生成教程内容
 * @param {string} topic - 主题
 * @param {string} category - 分类
 * @param {object} sourceInfo - 来源信息
 */
async function generateTutorial(topic, category, sourceInfo) {
  const date = new Date().toISOString().split('T')[0];
  const filename = `${date}-${topic.toLowerCase().replace(/\s+/g, '-')}.md`;
  
  // 这里调用AI生成内容
  // 实际使用时，可以通过API调用LLM生成
  const content = TUTORIAL_TEMPLATE
    .replace(/{{title}}/g, topic)
    .replace(/{{date}}/g, date)
    .replace(/{{category}}/g, category)
    .replace(/{{tags}}/g, sourceInfo.tags.map(t => `  - ${t}`).join('\n'))
    .replace(/{{description}}/g, `深入理解${topic}的核心原理与实战应用`)
    .replace(/{{cover}}/g, 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800')
    .replace(/{{overview}}/g, `${topic}是当前AI领域的重要技术方向...`)
    .replace(/{{concepts}}/g, '待AI生成')
    .replace(/{{code_example}}/g, '# 待AI生成代码示例')
    .replace(/{{best_practices}}/g, '待AI生成最佳实践')
    .replace(/{{faq}}/g, '待AI生成常见问题')
    .replace(/{{summary}}/g, '待AI生成总结')
    .replace(/{{resources}}/g, '- [官方文档](https://example.com)')
    .replace(/{{next_topic}}/g, '待定');

  const filepath = path.join(CONFIG.outputDir, filename);
  fs.writeFileSync(filepath, content, 'utf8');
  
  console.log(`✅ 生成教程: ${filename}`);
  return { filename, filepath, topic, category, date };
}

/**
 * 保存生成日志
 */
function saveLog(entry) {
  let logs = [];
  if (fs.existsSync(CONFIG.logFile)) {
    logs = JSON.parse(fs.readFileSync(CONFIG.logFile, 'utf8'));
  }
  logs.push({ ...entry, timestamp: new Date().toISOString() });
  fs.writeFileSync(CONFIG.logFile, JSON.stringify(logs, null, 2), 'utf8');
}

/**
 * 获取待生成的主题列表
 */
function getPendingTopics() {
  const schedule = {
    week1: [
      { topic: 'Transformer架构深度解析', category: 'LLM', priority: 'high' },
      { topic: 'LangChain Agent开发实战', category: 'Agent', priority: 'high' },
      { topic: 'RAG系统从零搭建', category: 'RAG', priority: 'high' },
    ],
    week2: [
      { topic: 'LoRA微调实战指南', category: 'LLM', priority: 'medium' },
      { topic: 'AutoGen多Agent协作', category: 'Agent', priority: 'medium' },
      { topic: '向量数据库选型指南', category: 'RAG', priority: 'medium' },
    ],
    // ... 更多主题
  };
  return schedule;
}

// 主程序
if (require.main === module) {
  const command = process.argv[2];
  
  switch (command) {
    case 'generate':
      const topic = process.argv[3] || 'AI技术入门';
      const category = process.argv[4] || 'AI';
      const source = CONTENT_SOURCES[category.toLowerCase()] || CONTENT_SOURCES.tools;
      generateTutorial(topic, category, source)
        .then(result => {
          saveLog(result);
          console.log('生成完成:', result);
        })
        .catch(console.error);
      break;
      
    case 'schedule':
      console.log('待生成主题:', JSON.stringify(getPendingTopics(), null, 2));
      break;
      
    case 'log':
      if (fs.existsSync(CONFIG.logFile)) {
        console.log('生成日志:', fs.readFileSync(CONFIG.logFile, 'utf8'));
      } else {
        console.log('暂无生成日志');
      }
      break;
      
    default:
      console.log(`
AI技术博客自动化内容生成器

用法:
  node content-generator.js generate <topic> [category]  - 生成教程
  node content-generator.js schedule                      - 查看待生成主题
  node content-generator.js log                           - 查看生成日志

分类: llm, agent, rag, tools
      `);
  }
}

module.exports = { generateTutorial, CONTENT_SOURCES };
