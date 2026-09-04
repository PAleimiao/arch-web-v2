#!/usr/bin/env node
/**
 * 快速新建一个应用：
 *   node scripts/create-app.mjs <应用id>
 *
 * 会创建 src/apps/<id>/index.tsx 并在 registry.ts 中插入元数据。
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const id = process.argv[2];
if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error('用法：node scripts/create-app.mjs <应用id>');
  console.error('示例：node scripts/create-app.mjs music-player');
  process.exit(1);
}

const dir = resolve(root, 'src/apps', id);
const file = resolve(dir, 'index.tsx');
if (existsSync(file)) {
  console.error(`已存在：${file}`);
  process.exit(1);
}

mkdirSync(dir, { recursive: true });

const template = `import type { AppProps } from '@/shell/types';

export default function ${toPascal(id)}({ context: _ }: AppProps) {
  return (
    <div className="flex h-full items-center justify-center bg-arch-bg text-arch-text">
      <div className="text-center">
        <h2 className="mb-2 text-lg">${toPascal(id)}</h2>
        <p className="text-xs text-arch-muted">在 src/apps/${id}/index.tsx 开始实现</p>
      </div>
    </div>
  );
}
`;
writeFileSync(file, template);

// 注册表插入元数据
const registry = resolve(root, 'src/apps/registry.ts');
let txt = readFileSync(registry, 'utf8');

// 1. ENTRY 表
const entryRe = /(\{\s*terminal: '\.\/Terminal\/index\.tsx',[\s\S]*?)(\s*\};)/;
if (entryRe.test(txt)) {
  txt = txt.replace(
    entryRe,
    (m, head, tail) =>
      `${head}  ${id}: './${toPascal(id)}/index.tsx',${tail}`,
  );
} else {
  console.error('未在 ENTRY 表里找到插入点，请手动更新 registry.ts');
  process.exit(1);
}

// 2. APPS 元数据（默认系统类）
const metaBlock = `  {
    id: '${id}',
    name: '${toPascal(id)}',
    icon: Terminal,
    category: '系统',
    description: '在 src/apps/${id}/index.tsx 中实现',
    defaultWidth: 720,
    defaultHeight: 480,
    accent: '#1793d1',
  },`;
const insertBefore = '];\n\nexport function loadApp';
const re2 = /(export const APPS: AppMeta\[\] = \[\n)([\s\S]*?)(];\n)/;
if (re2.test(txt)) {
  txt = txt.replace(re2, (m, head, body, tail) => {
    if (body.includes(`id: '${id}'`)) return m;
    return `${head}${body}\n${metaBlock}${tail}`;
  });
} else {
  console.error('未找到 APPS 数组插入点，请手动添加 ${id} 的元数据');
}

writeFileSync(registry, txt);
console.log(`✓ 已创建 src/apps/${id}/index.tsx`);
console.log(`✓ 已更新 src/apps/registry.ts（请挑个 lucide 图标替换占位）`);

function toPascal(s) {
  return s
    .split('-')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
}
