import { useState } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Home, Lock } from 'lucide-react';
import type { AppProps } from '@/shell/types';

/**
 * 浏览器：把任何 URL 渲染到沙箱 iframe 里。
 * - 受限于 iframe sandbox，不能直接执行对方脚本
 * - 遇到 X-Frame-Options / CSP frame-ancestors 限制的站点会显示空内容
 * - 这是一个**安全、可演示**的内嵌浏览器，不是一个真浏览器
 */
const HOME = 'https://duckduckgo.com';

export default function Browser({ context }: AppProps) {
  const [url, setUrl] = useState(HOME);
  const [current, setCurrent] = useState(HOME);
  const [history, setHistory] = useState<string[]>([HOME]);
  const [cursor, setCursor] = useState(0);

  const navigate = (next: string) => {
    let target = next.trim();
    if (!target) return;
    if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
    setCurrent(target);
    const newHist = [...history.slice(0, cursor + 1), target];
    setHistory(newHist);
    setCursor(newHist.length - 1);
    setUrl(target);
  };

  const goBack = () => {
    if (cursor === 0) return;
    const next = cursor - 1;
    setCursor(next);
    setCurrent(history[next]);
    setUrl(history[next]);
  };

  const goForward = () => {
    if (cursor >= history.length - 1) return;
    const next = cursor + 1;
    setCursor(next);
    setCurrent(history[next]);
    setUrl(history[next]);
  };

  const reload = () => {
    // 通过给 src 加随机参数强制刷新
    setCurrent((c) => c + (c.includes('?') ? '&' : '?') + `t=${Date.now()}`);
  };

  return (
    <div className="flex h-full flex-col bg-arch-bg text-arch-text">
      <div className="flex items-center gap-1 border-b border-arch-border bg-arch-panel/80 px-2 py-1.5">
        <button
          type="button"
          onClick={goBack}
          disabled={cursor === 0}
          className="rounded p-1 hover:bg-white/10 disabled:opacity-30"
        >
          <ArrowLeft size={14} />
        </button>
        <button
          type="button"
          onClick={goForward}
          disabled={cursor >= history.length - 1}
          className="rounded p-1 hover:bg-white/10 disabled:opacity-30"
        >
          <ArrowRight size={14} />
        </button>
        <button
          type="button"
          onClick={reload}
          className="rounded p-1 hover:bg-white/10"
        >
          <RotateCw size={14} />
        </button>
        <button
          type="button"
          onClick={() => navigate(HOME)}
          className="rounded p-1 hover:bg-white/10"
        >
          <Home size={14} />
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            navigate(url);
          }}
          className="flex-1"
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
            className="w-full rounded-full border border-arch-border bg-black/30 px-3 py-1 font-mono text-xs"
          />
        </form>
        <button
          type="button"
          onClick={() =>
            window.open(current, '_blank', 'noopener,noreferrer')
          }
          title="在新标签页打开"
          className="rounded p-1 hover:bg-white/10"
        >
          <Lock size={12} />
        </button>
      </div>
      <iframe
        key={current}
        src={current}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        referrerPolicy="no-referrer"
        className="flex-1 border-0 bg-white"
        title="browser"
      />
      <div className="border-t border-arch-border bg-arch-panel/40 px-3 py-1 text-[10px] text-arch-muted">
        沙箱模式：网站脚本受限；带 X-Frame-Options 的站点可能拒绝嵌入
      </div>
    </div>
  );
}
