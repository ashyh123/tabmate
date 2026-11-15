// 依赖规则检查（TM-001「依赖规则」，TM-002「四、依赖规则检查」）。不依赖任何 npm 包，hygiene job 不需要安装依赖。
//
// 规则：
//   1. src/features/<a>/ 不得引用 src/features/<b>/。
//   2. src/core/ 不得引用 src/features/。
//   3. src/core/secrets 和 src/core/llm 只能被 src/entrypoints/background 及其自身引用。
//
// 做法：用一个只认识注释、字符串、模板字符串和正则字面量的小型词法扫描去掉注释、替换字符串，
// 再从剩下的代码里找 import/export ... from、import '...'、import('...')、require('...')。
// 类型导入（import type）同样计入。动态 import 和 require 的参数不是字符串字面量时直接报错，因为无法检查。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, resolve } from 'node:path';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
// 与 WXT 生成的 tsconfig paths 一致。
const ALIASES = [
  ['@@', ''],
  ['~~', ''],
  ['@', 'src'],
  ['~', 'src'],
];
const PROTECTED_MODULES = ['src/core/secrets', 'src/core/llm'];
const BACKGROUND_ENTRY = 'src/entrypoints/background';

// 这些符号之后出现的 `/` 是正则字面量的开始，而不是除号。
const REGEX_PRECEDERS = new Set([
  '',
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '<',
  '>',
  '~',
  '^',
]);
const REGEX_KEYWORDS =
  /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

/**
 * 把源码中的注释换成空格，把每个 '...' / "..." 字符串换成 '#<序号>'，模板字符串的文字部分换成空格。
 * 返回处理后的代码和字符串表。一行内找不到配对引号的 ' 或 "（如 JSX 文本里的撇号）按普通字符处理。
 */
export function scan(source) {
  const strings = [];
  let out = '';
  let i = 0;
  let lastSignificant = '';
  const templateDepth = []; // 每一层 ${ 进入代码时的大括号深度
  let braceDepth = 0;

  const readString = (quote) => {
    let j = i + 1;
    let value = '';
    while (j < source.length) {
      const c = source[j];
      if (c === '\\') {
        value += source[j + 1] ?? '';
        j += 2;
        continue;
      }
      if (c === '\n') return null;
      if (c === quote) return { value, end: j + 1 };
      value += c;
      j += 1;
    }
    return null;
  };

  // 从模板字符串的文字部分开始扫描，直到结束的 ` 或进入 ${。
  const skipTemplateText = () => {
    while (i < source.length) {
      const c = source[i];
      if (c === '\\') {
        out += '  ';
        i += 2;
      } else if (c === '`') {
        out += '`';
        i += 1;
        lastSignificant = '`';
        return;
      } else if (c === '$' && source[i + 1] === '{') {
        out += '${';
        i += 2;
        braceDepth += 1;
        templateDepth.push(braceDepth);
        lastSignificant = '{';
        return;
      } else {
        out += c === '\n' ? '\n' : ' ';
        i += 1;
      }
    }
  };

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    if (
      c === '/' &&
      (REGEX_PRECEDERS.has(lastSignificant) || REGEX_KEYWORDS.test(out.slice(-40).trimEnd()))
    ) {
      // 正则字面量：跳到未转义、不在字符类中的 /。
      let j = i + 1;
      let inClass = false;
      while (j < source.length && source[j] !== '\n') {
        const d = source[j];
        if (d === '\\') j += 1;
        else if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
        j += 1;
      }
      if (source[j] === '/') {
        out += ' '.repeat(j + 1 - i);
        i = j + 1;
        lastSignificant = 'regex';
        continue;
      }
    }
    if (c === "'" || c === '"') {
      const str = readString(c);
      if (str) {
        out += `${c}#${strings.length}${c}`;
        strings.push(str.value);
        i = str.end;
        lastSignificant = 'string';
        continue;
      }
    }
    if (c === '`') {
      out += '`';
      i += 1;
      skipTemplateText();
      continue;
    }
    if (c === '{') braceDepth += 1;
    if (c === '}') {
      if (templateDepth.length > 0 && templateDepth[templateDepth.length - 1] === braceDepth) {
        templateDepth.pop();
        braceDepth -= 1;
        out += '}';
        i += 1;
        skipTemplateText();
        continue;
      }
      braceDepth -= 1;
    }
    out += c;
    if (!/\s/.test(c)) lastSignificant = /[\w$]/.test(c) ? 'word' : c;
    i += 1;
  }
  return { code: out, strings };
}

/** 返回源码中所有静态的模块说明符，以及无法静态检查的动态引用。 */
export function findImports(source) {
  const { code, strings } = scan(source);
  const specifiers = [];
  const dynamic = [];
  const patterns = [
    /(?<![\w$.])(?:import|export)(?![\w$])[^;'"]*?(?<![\w$])from\s*(['"])#(\d+)\1/g,
    /(?<![\w$.])import\s*(['"])#(\d+)\1/g,
    /(?<![\w$.])(?:import|require)\s*\(\s*(['"])#(\d+)\1\s*[,)]/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) specifiers.push(strings[Number(match[2])]);
  }
  for (const match of code.matchAll(
    /(?<![\w$.])(import|require)\s*\(\s*(?!['"]#\d+['"]\s*[,)])/g,
  )) {
    dynamic.push(`${match[1]}(...)`);
  }
  return { specifiers, dynamic };
}

/**
 * 把说明符解析成仓库内的相对路径（posix）。外部包返回 null。
 * fileExists 接收仓库相对路径；找不到具体文件时返回去掉扩展名前的基础路径，规则按路径前缀判断。
 */
export function resolveSpecifier(fromFile, specifier, fileExists) {
  let base;
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    base = posix.join(posix.dirname(fromFile), specifier);
  } else {
    const alias = ALIASES.find(([name]) => specifier === name || specifier.startsWith(`${name}/`));
    if (!alias) return null;
    base = posix.normalize(posix.join(alias[1] || '.', specifier.slice(alias[0].length)));
  }
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...SOURCE_EXTENSIONS.map((ext) => `${base}/index${ext}`),
  ];
  return candidates.find((candidate) => fileExists(candidate)) ?? base;
}

const within = (path, dir) =>
  path === dir || path.startsWith(`${dir}/`) || path.startsWith(`${dir}.`);

function featureOf(path) {
  const match = /^src\/features\/([^/]+)\//.exec(`${path}/`);
  if (!match) return null;
  // src/features/index.ts 是清单文件，不属于任何功能。
  return /^index\.[cm]?[jt]sx?$/.test(match[1]) ? null : match[1];
}

/** 对一个文件的一条引用检查三条规则，返回违规说明。 */
export function checkEdge(importer, target) {
  const violations = [];
  const fromFeature = featureOf(importer);
  const toFeature = featureOf(target);
  if (fromFeature && toFeature && fromFeature !== toFeature) {
    violations.push(`${importer} 引用了另一个功能 ${target}（功能之间不得互相引用）`);
  }
  if (within(importer, 'src/core') && within(target, 'src/features')) {
    violations.push(`${importer} 引用了 ${target}（core 不得引用 features）`);
  }
  for (const module of PROTECTED_MODULES) {
    if (
      within(target, module) &&
      !within(importer, module) &&
      !within(importer, BACKGROUND_ENTRY)
    ) {
      violations.push(`${importer} 引用了 ${target}（${module} 只能被后台入口引用）`);
    }
  }
  return violations;
}

/** files：仓库相对路径（posix）→ 源码。只检查 src/ 下的文件。 */
export function checkDeps(files) {
  const paths = new Set(files.keys());
  const violations = [];
  for (const [file, source] of files) {
    if (!file.startsWith('src/')) continue;
    const { specifiers, dynamic } = findImports(source);
    for (const call of dynamic) {
      violations.push(`${file} 中的 ${call} 参数不是字符串字面量，无法检查依赖规则`);
    }
    for (const specifier of specifiers) {
      const target = resolveSpecifier(file, specifier, (path) => paths.has(path));
      if (target !== null) violations.push(...checkEdge(file, target));
    }
  }
  return violations;
}

function listSourceFiles(dir) {
  const result = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) result.push(...listSourceFiles(path));
    else if (SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext))) result.push(path);
  }
  return result;
}

/** 读取仓库 src/ 下的全部源文件并检查。 */
export function checkRepoDeps(root) {
  const srcDir = resolve(root, 'src');
  if (!existsSync(srcDir)) return { checked: 0, violations: [] };
  const files = new Map(
    listSourceFiles(srcDir).map((path) => [
      relative(root, path).split('\\').join('/'),
      readFileSync(path, 'utf8'),
    ]),
  );
  return { checked: files.size, violations: checkDeps(files) };
}
