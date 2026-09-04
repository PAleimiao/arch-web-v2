import { useEffect, useRef, useState } from 'react';
import { vfs } from '@/services/filesystem';
import { useWindowStore } from '@/stores/useWindowStore';
import { APPS } from '@/apps/registry';
import type { AppProps } from '@/shell/types';

interface Line {
  kind: 'input' | 'output' | 'error';
  text: string;
}

const HELP = [
  '可用命令：',
  '  help              显示本帮助',
  '  ls [目录]         列出目录内容',
  '  cd <目录>         切换目录',
  '  pwd               显示当前目录',
  '  cat <文件>        查看文件内容',
  '  echo <文本> >file 写入文件',
  '  mkdir <目录>      创建目录（写入 .keep）',
  '  touch <文件>      创建空文件',
  '  rm <路径>         删除文件或目录',
  '  open <应用id>     打开应用',
  '  apps              列出所有应用 id',
  '  neofetch          系统信息',
  '  clear             清屏',
];

export default function Terminal({ context }: AppProps) {
  const [lines, setLines] = useState<Line[]>([
    { kind: 'output', text: 'Arch Web OS v2 — 终端' },
    { kind: 'output', text: '输入 help 查看可用命令。' },
    { kind: 'output', text: '' },
  ]);
  const [input, setInput] = useState('');
  const [cwd, setCwd] = useState('/home/arch');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [lines]);

  const print = (text: string, kind: Line['kind'] = 'output') =>
    setLines((prev) => [...prev, { kind, text }]);

  const run = async (raw: string) => {
    const cmd = raw.trim();
    if (!cmd) return;
    setLines((prev) => [...prev, { kind: 'input', text: `${cwd} $ ${cmd}` }]);
    setBusy(true);

    const [name, ...args] = cmd.split(/\s+/);
    try {
      switch (name) {
        case 'help':
          HELP.forEach((l) => print(l));
          break;

        case 'clear':
          setLines([]);
          break;

        case 'pwd':
          print(cwd);
          break;

        case 'ls': {
          const nodes = await vfs.listDir(vfs.resolve(cwd, args[0] ?? ''));
          if (nodes.length === 0) print('（空目录）');
          else
            nodes.forEach((n) =>
              print(
                n.type === 'dir'
                  ? `${n.name}/`
                  : `${n.name.padEnd(24)} ${n.size}B`,
              ),
            );
          break;
        }

        case 'cd': {
          if (!args[0]) {
            setCwd('/home/arch');
            break;
          }
          const target = vfs.resolve(cwd, args[0]);
          const nodes = await vfs.listDir(vfs.parentOf(target));
          const hit = nodes.find((n) => n.path === target && n.type === 'dir');
          if (hit || target === '/') setCwd(target);
          else print(`cd: ${args[0]}: 不是目录`, 'error');
          break;
        }

        case 'cat': {
          if (!args[0]) {
            print('用法: cat <文件>', 'error');
            break;
          }
          const content = await vfs.readFile(vfs.resolve(cwd, args[0]));
          if (content === null) print(`cat: ${args[0]}: 没有该文件`, 'error');
          else content.split('\n').forEach((l) => print(l));
          break;
        }

        case 'echo': {
          // 支持 echo 文本 > 文件
          const gt = args.findIndex((a) => a.startsWith('>'));
          if (gt >= 0) {
            const text = args.slice(0, gt).join(' ');
            const target = vfs.resolve(cwd, args[gt].slice(1));
            await vfs.writeFile(target, text);
            print(`已写入 ${target}`);
          } else {
            print(args.join(' '));
          }
          break;
        }

        case 'mkdir': {
          if (!args[0]) {
            print('用法: mkdir <目录>', 'error');
            break;
          }
          await vfs.writeFile(`${vfs.resolve(cwd, args[0])}/.keep`, '');
          print(`已创建 ${vfs.resolve(cwd, args[0])}`);
          break;
        }

        case 'touch': {
          if (!args[0]) {
            print('用法: touch <文件>', 'error');
            break;
          }
          const target = vfs.resolve(cwd, args[0]);
          if ((await vfs.readFile(target)) === null) {
            await vfs.writeFile(target, '');
          }
          print(target);
          break;
        }

        case 'rm': {
          if (!args[0]) {
            print('用法: rm <路径>', 'error');
            break;
          }
          await vfs.remove(vfs.resolve(cwd, args[0]));
          print(`已删除 ${args[0]}`);
          break;
        }

        case 'open': {
          const app = APPS.find((a) => a.id === args[0]);
          if (!app) {
            print(`未知应用: ${args[0]}，用 apps 看列表`, 'error');
            break;
          }
          useWindowStore.getState().open({
            appId: app.id,
            title: app.name,
            width: app.defaultWidth,
            height: app.defaultHeight,
          });
          print(`正在打开 ${app.name}`);
          break;
        }

        case 'apps':
          APPS.forEach((a) => print(`${a.id.padEnd(12)} ${a.name}`));
          break;

        case 'neofetch': {
          const backend = await vfs.backend();
          print('       /\\        arch@web');
          print('      /  \\       --------');
          print('     /\\   \\      OS      : Arch Web OS v2');
          print('    /      \\     Kernel  : web-6.8.0-arch1-1');
          print('   /   ,,   \\    Shell   : wsh 2.0');
          print('  /   |  |  -\\   Storage : ' + backend);
          print(" /_-'    '-_\\  Apps    : " + APPS.length);
          break;
        }

        case 'exit':
          context.close();
          break;

        default:
          print(`${name}: 未找到命令，输入 help 看列表`, 'error');
      }
    } catch (err) {
      print(`${name}: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex h-full flex-col bg-[#0b0e14]/85 p-2 text-[12px] leading-5 text-arch-text"
      onClick={() => inputRef.current?.focus()}
    >
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
        {lines.map((line, i) => (
          <div
            key={i}
            className={
              line.kind === 'input'
                ? 'text-arch-accent'
                : line.kind === 'error'
                  ? 'text-arch-red'
                  : 'text-arch-text/90'
            }
          >
            {line.text || ' '}
          </div>
        ))}
      </div>

      <div className="mt-1 flex items-center gap-1 border-t border-arch-border pt-2">
        <span className="shrink-0 text-arch-green">{cwd} $</span>
        <input
          ref={inputRef}
          autoFocus
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              void run(input);
              setInput('');
            }
          }}
          className="flex-1 bg-transparent text-arch-text outline-none"
          spellCheck={false}
        />
      </div>
    </div>
  );
}
