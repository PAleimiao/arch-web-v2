import { useEffect, useMemo, useState } from 'react';
import { HelpCircle, Search, BookOpen, Command, Terminal, ExternalLink } from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';
import { APPS } from '@/apps/registry';
import { useWindowStore } from '@/stores/useWindowStore';

type SectionId = 'apps' | 'shortcuts' | 'commands' | 'faq';

const SECTIONS: Array<[SectionId, string]> = [
  ['apps', '应用列表'],
  ['shortcuts', '全局快捷键'],
  ['commands', '终端命令'],
  ['faq', '常见问题'],
];

const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl + Alt + T', '打开终端'],
  ['Ctrl + Shift + P / Ctrl + K', '打开命令面板'],
  ['Ctrl + L', '锁屏'],
  ['Alt + F4', '关闭当前窗口'],
  ['Ctrl + Shift + W', '关闭全部窗口'],
  ['Super（Win 键）', '打开应用启动器'],
  ['Esc', '关闭面板 / 弹窗'],
  ['拖到左 / 右边缘', '窗口贴左 / 右半屏'],
  ['拖到顶部', '窗口最大化'],
];

const COMMANDS: Array<[string, string]> = [
  ['ls', '列出当前目录内容'],
  ['cd', '切换目录（支持 ..）'],
  ['cat', '查看文件内容'],
  ['echo', '输出文本'],
  ['mkdir', '新建目录'],
  ['rm', '删除文件或目录'],
  ['mv', '移动 / 重命名'],
  ['cp', '复制文件'],
  ['touch', '新建空文件'],
  ['tree', '树状展示目录结构'],
  ['find', '按名称查找文件'],
  ['grep', '在文件内搜索文本'],
  ['head / tail', '查看文件头 / 尾几行'],
  ['wc', '统计行数 / 词数 / 字符数'],
  ['stat', '查看文件元信息'],
  ['df / du', '查看磁盘用量 / 目录占用'],
  ['date', '显示当前日期时间'],
  ['whoami', '显示当前用户'],
  ['uname', '显示系统信息'],
  ['ps / top', '查看进程 / 资源占用'],
  ['history', '命令历史'],
  ['man', '查看命令手册'],
  ['clear', '清屏'],
  ['open', '在浏览器中打开应用'],
  ['pacman', '（演示）包管理提示'],
];

const FAQ: Array<[string, string]> = [
  [
    '我的数据存在哪里？',
    '所有文件保存在浏览器本地：优先使用 OPFS（源私有文件系统），不可用时降级到 IndexedDB。它们都只属于当前浏览器，不会上传到任何服务器。',
  ],
  [
    '怎么备份我的文件？',
    '在「终端」里可以用 listAll 列出的文件导出，或通过「文件管理器」逐个打开复制。由于数据都在本地，重装浏览器或清理站点数据会丢失内容，建议重要文件导出备份。',
  ],
  [
    '为什么刷新后某些 blob 链接失效了？',
    '临时对象 URL（blob:）只在创建它的会话内有效，刷新或关闭标签页后会失效。需要长期保留的内容请写入文件系统（如 /home/arch 下），而不是依赖内存里的 blob。',
  ],
  [
    '窗口标题怎么改？',
    '应用内可调用 context.setTitle(标题)；拖动窗口到屏幕边缘可半屏或最大化，顶部标题栏双击也能最大化。',
  ],
  [
    '支持哪些应用？',
    '左侧「应用列表」会动态读取注册表，展示当前所有已安装应用，点击「打开」即可启动。',
  ],
];

function matches(haystack: string, q: string): boolean {
  return haystack.toLowerCase().includes(q.toLowerCase());
}

export default function Help({ context }: AppProps) {
  useEffect(() => {
    context.setTitle('帮助手册');
  }, [context]);

  const [section, setSection] = useState<SectionId>('apps');
  const [query, setQuery] = useState('');

  const appsByCat = useMemo(() => {
    const map = new Map<string, typeof APPS>();
    for (const a of APPS) {
      const list = map.get(a.category) ?? [];
      list.push(a);
      map.set(a.category, list);
    }
    return [...map.entries()];
  }, []);

  const filteredApps = useMemo(() => {
    const q = query.trim();
    return appsByCat.map(([cat, list]) => [
      cat,
      q ? list.filter((a) => matches(a.name, q) || matches(a.description, q)) : list,
    ]);
  }, [appsByCat, query]);

  const filteredCommands = query.trim()
    ? COMMANDS.filter(([c, d]) => matches(c, query) || matches(d, query))
    : COMMANDS;
  const filteredShortcuts = query.trim()
    ? SHORTCUTS.filter(([k, d]) => matches(k, query) || matches(d, query))
    : SHORTCUTS;
  const filteredFaq = query.trim()
    ? FAQ.filter(([q, a]) => matches(q, query) || matches(a, query))
    : FAQ;

  const openApp = (appId: string, name: string, singleton?: boolean) => {
    useWindowStore.getState().open({ appId, title: name, singleton });
  };

  return (
    <div className="flex h-full flex-col bg-arch-bg text-arch-text">
      <div className="flex items-center gap-2 border-b border-arch-border bg-arch-panel/80 px-3 py-1.5">
        <HelpCircle size={14} className="text-arch-accent" />
        <span className="text-xs font-medium">帮助手册</span>
        <div className="ml-auto flex items-center gap-1 rounded border border-arch-border bg-black/30 px-2 py-0.5">
          <Search size={12} className="text-arch-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索条目…"
            className="w-40 bg-transparent text-xs outline-none"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav className="w-32 shrink-0 border-r border-arch-border bg-arch-panel/40 p-2">
          {SECTIONS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={cn(
                'mb-1 flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs',
                section === id ? 'bg-arch-accent text-white' : 'hover:bg-white/10',
              )}
            >
              {id === 'apps' && <BookOpen size={13} />}
              {id === 'shortcuts' && <Command size={13} />}
              {id === 'commands' && <Terminal size={13} />}
              {id === 'faq' && <HelpCircle size={13} />}
              {label}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 text-[12px] leading-5">
          {section === 'apps' && (
            <div className="space-y-4">
              {(filteredApps as Array<[string, typeof APPS]>).map(([cat, list]) =>
                list.length > 0 ? (
                  <div key={cat}>
                    <h3 className="mb-2 text-[11px] text-arch-muted">{cat}</h3>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {list.map((a) => {
                        const Icon = a.icon;
                        return (
                          <div
                            key={a.id}
                            className="flex items-center gap-2 rounded border border-arch-border bg-arch-panel/40 p-2"
                          >
                            <Icon size={18} style={{ color: a.accent ?? '#1793d1' }} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">{a.name}</div>
                              <div className="truncate text-[11px] text-arch-muted">
                                {a.description}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => openApp(a.id, a.name, a.singleton)}
                              className="flex items-center gap-1 rounded bg-arch-accent px-2 py-1 text-[11px] text-white hover:bg-arch-accent/80"
                            >
                              <ExternalLink size={11} /> 打开
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null,
              )}
              {filteredApps.every(([, list]) => list.length === 0) && (
                <p className="text-arch-muted">没有匹配「{query}」的应用。</p>
              )}
            </div>
          )}

          {section === 'shortcuts' && (
            <div className="space-y-1">
              <h3 className="mb-2 text-[11px] text-arch-muted">全局快捷键</h3>
              {filteredShortcuts.map(([k, d]) => (
                <div
                  key={k}
                  className="flex items-center justify-between rounded border border-arch-border bg-arch-panel/40 px-3 py-1.5"
                >
                  <span className="font-mono text-arch-accent">{k}</span>
                  <span className="text-arch-muted">{d}</span>
                </div>
              ))}
              {filteredShortcuts.length === 0 && (
                <p className="text-arch-muted">没有匹配的快捷键。</p>
              )}
            </div>
          )}

          {section === 'commands' && (
            <div className="space-y-1">
              <h3 className="mb-2 text-[11px] text-arch-muted">终端命令速查</h3>
              {filteredCommands.map(([c, d]) => (
                <div
                  key={c}
                  className="flex items-center justify-between gap-3 rounded border border-arch-border bg-arch-panel/40 px-3 py-1.5"
                >
                  <span className="shrink-0 font-mono text-arch-green">{c}</span>
                  <span className="text-right text-arch-muted">{d}</span>
                </div>
              ))}
              {filteredCommands.length === 0 && (
                <p className="text-arch-muted">没有匹配的命令。</p>
              )}
            </div>
          )}

          {section === 'faq' && (
            <div className="space-y-3">
              <h3 className="mb-2 text-[11px] text-arch-muted">常见问题</h3>
              {filteredFaq.map(([q, a]) => (
                <div
                  key={q}
                  className="rounded border border-arch-border bg-arch-panel/40 p-3"
                >
                  <div className="mb-1 font-medium text-arch-text">{q}</div>
                  <div className="text-arch-muted">{a}</div>
                </div>
              ))}
              {filteredFaq.length === 0 && (
                <p className="text-arch-muted">没有匹配的问题。</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
