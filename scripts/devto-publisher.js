#!/usr/bin/env node
/**
 * Dev.to 自动发布脚本
 * 功能：将Hexo文章同步发布到Dev.to
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Dev.to API 配置
const DEVTO_API_KEY = process.env.DEVTO_API_KEY || 'BXAftUNMUdrC8wbNGcKmdsU7';
const DEVTO_API_BASE = 'https://dev.to/api';

// Hexo 文章目录
const POSTS_DIR = path.join(__dirname, '..', 'source', '_posts');

/**
 * 发送 Dev.to API 请求
 */
function devtoRequest(endpoint, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'dev.to',
      path: endpoint,
      method: method,
      headers: {
        'api-key': DEVTO_API_KEY,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve(body);
        }
      });
    });

    req.on('error', reject);
    
    const postData = JSON.stringify(data);
    req.write(postData);
    
    req.end();
  });
}

/**
 * 解析 Hexo Markdown 文章
 */
function parseHexoPost(filepath) {
  const content = fs.readFileSync(filepath, 'utf8');
  
  // 解析 frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    return null;
  }

  const frontmatter = frontmatterMatch[1];
  const body = frontmatterMatch[2];

  // 提取字段
  const title = frontmatter.match(/title:\s*(.+)/)?.[1]?.replace(/['"]/g, '') || '';
  const description = frontmatter.match(/description:\s*(.+)/)?.[1]?.replace(/['"]/g, '') || '';
  const tags = frontmatter.match(/tags:\s*\n((?:\s*-\s*.+\n?)+)/)?.[1]
    ?.split('\n')
    .filter(t => t.trim())
    .map(t => t.replace(/^\s*-\s*/, '').trim()) || [];
  const coverImage = frontmatter.match(/cover:\s*(.+)/)?.[1]?.trim() || '';
  const published = frontmatter.match(/published:\s*(false)/)?.[1] !== 'false';

  return {
    title,
    description,
    tags: tags.slice(0, 4), // Dev.to 最多4个标签
    body_markdown: body,
    cover_image: coverImage,
    published,
    canonical_url: `https://lijesom9-create.github.io/ai-tech-blog/${path.basename(filepath, '.md')}/`,
  };
}

/**
 * 获取已发布的文章列表
 */
async function getPublishedArticles() {
  try {
    const articles = await devtoRequest('/articles/me?per_page=100');
    return articles || [];
  } catch (error) {
    console.error('获取已发布文章失败:', error.message);
    return [];
  }
}

/**
 * 发布文章到 Dev.to
 */
async function publishArticle(article) {
  try {
    const result = await devtoRequest('/articles', 'POST', { article });
    console.log(`✅ 发布成功: ${result.url}`);
    return result;
  } catch (error) {
    console.error('发布失败:', error.message);
    return null;
  }
}

/**
 * 更新已发布的文章
 */
async function updateArticle(articleId, article) {
  try {
    const result = await devtoRequest(`/articles/${articleId}`, 'PUT', { article });
    console.log(`✅ 更新成功: ${result.url}`);
    return result;
  } catch (error) {
    console.error('更新失败:', error.message);
    return null;
  }
}

/**
 * 同步所有文章到 Dev.to
 */
async function syncAllPosts() {
  console.log('🚀 开始同步文章到 Dev.to...\n');

  // 获取已发布的文章
  const publishedArticles = await getPublishedArticles();
  const publishedTitles = new Map(publishedArticles.map(a => [a.title, a]));

  // 读取本地文章
  const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md'));
  
  let newCount = 0;
  let updateCount = 0;
  let skipCount = 0;

  for (const file of files) {
    const filepath = path.join(POSTS_DIR, file);
    const article = parseHexoPost(filepath);
    
    if (!article) {
      console.log(`⚠️ 跳过无效文件: ${file}`);
      continue;
    }

    const existing = publishedTitles.get(article.title);
    
    if (existing) {
      // 检查是否需要更新
      console.log(`⏭️ 已存在: ${article.title}`);
      skipCount++;
    } else {
      // 发布新文章
      console.log(`📝 发布新文章: ${article.title}`);
      await publishArticle(article);
      newCount++;
    }
  }

  console.log(`\n📊 同步完成:`);
  console.log(`  - 新发布: ${newCount}`);
  console.log(`  - 更新: ${updateCount}`);
  console.log(`  - 跳过: ${skipCount}`);
}

// 主程序
if (require.main === module) {
  const command = process.argv[2];
  
  switch (command) {
    case 'publish':
      // 发布单篇文章
      const filename = process.argv[3];
      if (!filename) {
        console.log('用法: node devto-publisher.js publish <filename>');
        break;
      }
      const filepath = path.join(POSTS_DIR, filename);
      if (!fs.existsSync(filepath)) {
        console.log(`文件不存在: ${filepath}`);
        break;
      }
      const article = parseHexoPost(filepath);
      if (article) {
        publishArticle(article);
      }
      break;
      
    case 'sync':
      // 同步所有文章
      syncAllPosts();
      break;
      
    case 'list':
      // 列出已发布文章
      getPublishedArticles().then(articles => {
        console.log('已发布文章:');
        articles.forEach(a => {
          console.log(`  - ${a.title} (${a.url})`);
        });
      });
      break;
      
    default:
      console.log(`
Dev.to 自动发布工具

用法:
  node devto-publisher.js publish <filename>  - 发布单篇文章
  node devto-publisher.js sync                - 同步所有文章
  node devto-publisher.js list                - 列出已发布文章

示例:
  node devto-publisher.js publish ai-agent-overview.md
  node devto-publisher.js sync
      `);
  }
}

module.exports = { parseHexoPost, publishArticle, syncAllPosts };
