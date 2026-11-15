// 仓库卫生检查。纯函数导出供测试使用，CLI 入口只负责读取文件、环境变量和 git。
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TM_ID = /\bTM-\d{3}\b/;
// notion.so / notion.site 是约定的链接形式；Notion 工具返回的 app.notion.com 链接也接受。
const NOTION_URL = /https?:\/\/(?:[\w-]+\.)*(?:notion\.so|notion\.site|notion\.com)\/\S+/;

/** 返回 markdown 中所有相对链接的目标（去掉锚点），忽略外部链接和纯锚点。 */
export function relativeLinks(markdown) {
  const links = [];
  for (const match of markdown.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    const target = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
    links.push(target.split('#')[0]);
  }
  return links;
}

/**
 * docFiles：docs/ 下的 .md 文件名（不含 README.md 也可以，会被忽略）。
 * readme：docs/README.md 的内容。
 * exists：接收相对于 docs/ 的路径，返回该文件是否存在。
 */
export function checkDocsIndex({ docFiles, readme, exists }) {
  const violations = [];
  const linked = new Set(relativeLinks(readme).map((link) => normalize(link)));
  for (const file of docFiles) {
    if (file === 'README.md') continue;
    if (!linked.has(normalize(file))) {
      violations.push(`docs/${file} 没有在 docs/README.md 中链接`);
    }
  }
  for (const link of relativeLinks(readme)) {
    if (!exists(link)) {
      violations.push(`docs/README.md 中的链接 ${link} 指向不存在的文件`);
    }
  }
  return violations;
}

/** 改动了 src/ 时，PR 描述必须同时包含 TM-xxx 编号和 Notion 链接。 */
export function checkDocReference({ changedFiles, prBody }) {
  if (!changedFiles.some((file) => file.startsWith('src/'))) return [];
  const violations = [];
  if (!TM_ID.test(prBody)) {
    violations.push('PR 改动了 src/，但描述中没有实施文档编号（TM-xxx）');
  }
  if (!NOTION_URL.test(prBody)) {
    violations.push('PR 改动了 src/，但描述中没有实施文档的 Notion 链接');
  }
  return violations;
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const docsDir = join(root, 'docs');
  const violations = [];

  violations.push(
    ...checkDocsIndex({
      docFiles: readdirSync(docsDir).filter((name) => name.endsWith('.md')),
      readme: readFileSync(join(docsDir, 'README.md'), 'utf8'),
      exists: (link) => existsSync(join(docsDir, link)),
    }),
  );
  console.log('docs 索引检查：已运行');

  const prBody = process.env.PR_BODY;
  if (prBody === undefined) {
    console.log('实施文档引用检查：跳过（未设置 PR_BODY）');
  } else {
    const base = process.env.BASE_SHA;
    if (!base) {
      violations.push('设置了 PR_BODY 但没有设置 BASE_SHA，无法计算改动的文件');
    } else {
      const changedFiles = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
        cwd: root,
        encoding: 'utf8',
      })
        .split('\n')
        .filter(Boolean);
      violations.push(...checkDocReference({ changedFiles, prBody }));
      console.log(`实施文档引用检查：已运行（${changedFiles.length} 个改动文件）`);
    }
  }

  if (violations.length > 0) {
    console.error(`发现 ${violations.length} 个问题：`);
    for (const violation of violations) console.error(`- ${violation}`);
    process.exit(1);
  }
  console.log('没有发现问题');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
