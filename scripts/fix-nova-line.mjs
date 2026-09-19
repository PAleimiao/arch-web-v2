import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../src/apps/AbyssEcho/game.ts', import.meta.url);
let src = readFileSync(path, 'utf8');

const bad = /lines: \['我叫诺瓦[^\]]*'\]/;
if (!bad.test(src)) {
  console.error('未找到待修复的诺瓦台词块');
  process.exit(1);
}
src = src.replace(bad, "lines: ['我叫诺瓦。不过……这个名字，已经没有人记得了吧。', '姐姐……？呵呵，铃兰那孩子，还守在那个小村子里吗。', '真幸福啊。可惜——深渊不会允许任何人回头。']");
src = src.replace(/\n\s*\/\/ 修掉过场里误入的乱码\n\s*this\.dialog\[1\]\.lines\[2\] = [^\n]+\n/, '\n');

writeFileSync(path, src);
console.log('已修复诺瓦台词，乱码与补丁行均已清除');
