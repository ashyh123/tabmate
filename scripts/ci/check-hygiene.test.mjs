import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDocReference, checkDocsIndex } from './check-hygiene.mjs';

const existing = new Set(['product.md', 'architecture.md']);
const exists = (link) => existing.has(link);

test('docs 索引：每篇文档都有链接且链接都有效时通过', () => {
  const violations = checkDocsIndex({
    docFiles: ['README.md', 'product.md', 'architecture.md'],
    readme: '- [product.md](product.md)：产品\n- [architecture.md](architecture.md#决定)：架构\n- [外链](https://example.com)\n',
    exists,
  });
  assert.deepEqual(violations, []);
});

test('docs 索引：缺少某篇文档的条目时失败', () => {
  const violations = checkDocsIndex({
    docFiles: ['README.md', 'product.md', 'architecture.md'],
    readme: '- [product.md](product.md)\n',
    exists,
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /architecture\.md/);
});

test('docs 索引：链接指向不存在的文件时失败', () => {
  const violations = checkDocsIndex({
    docFiles: ['README.md', 'product.md'],
    readme: '- [product.md](product.md)\n- [旧文档](old.md)\n',
    exists,
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /old\.md/);
});

test('实施文档引用：没有改动 src/ 时通过', () => {
  assert.deepEqual(
    checkDocReference({ changedFiles: ['docs/product.md', 'README.md'], prBody: '' }),
    [],
  );
});

test('实施文档引用：改动 src/ 但缺少编号时失败', () => {
  const violations = checkDocReference({
    changedFiles: ['src/background.ts'],
    prBody: '见 https://www.notion.so/abc123',
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /TM-xxx/);
});

test('实施文档引用：改动 src/ 但缺少 Notion 链接时失败', () => {
  const violations = checkDocReference({
    changedFiles: ['src/background.ts'],
    prBody: 'TM-001 翻译管线',
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /Notion/);
});

test('实施文档引用：改动 src/ 且两者都缺少时报告两个问题', () => {
  const violations = checkDocReference({ changedFiles: ['src/a.ts'], prBody: '' });
  assert.equal(violations.length, 2);
});

test('实施文档引用：改动 src/ 且编号和链接都有时通过', () => {
  for (const url of [
    'https://www.notion.so/abc123',
    'https://someone.notion.site/abc123',
    'https://app.notion.com/p/abc123',
  ]) {
    assert.deepEqual(
      checkDocReference({ changedFiles: ['src/a.ts'], prBody: `TM-001 ${url}` }),
      [],
      url,
    );
  }
});
