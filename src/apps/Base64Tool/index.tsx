import { useState, useEffect, type ReactNode } from 'react';
import { Binary, Link2, Code, Copy, Check, Upload, AlertTriangle } from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';
import { notify } from '@/stores/useNotifyStore';

type Tab = 'base64' | 'url' | 'html';

const MAX_FILE = 5 * 1024 * 1024; // 5MB

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToUtf8(b64: string): string {
  const clean = b64.replace(/\s+/g, '');
  const bin = atob(clean);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseQuery(q: string): Array<[string, string]> {
  const raw = q.startsWith('?') ? q.slice(1) : q;
  const pairs: Array<[string, string]> = [];
  if (raw.trim() === '') return pairs;
  for (const part of raw.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq === -1) {
      try {
        pairs.push([decodeURIComponent(part), '']);
      } catch {
        pairs.push([part, '']);
      }
    } else {
      const k = part.slice(0, eq);
      const v = part.slice(eq + 1);
      try {
        pairs.push([decodeURIComponent(k), decodeURIComponent(v)]);
      } catch {
        pairs.push([k, v]);
      }
    }
  }
  return pairs;
}

export default function Base64Tool({ context }: AppProps) {
  useEffect(() => {
    context.setTitle('编解码工具');
  }, [context]);
  const [tab, setTab] = useState<Tab>('base64');

  // Base64 状态
  const [b64In, setB64In] = useState('Hello, 世界');
  const [b64Out, setB64Out] = useState('');
  const [b64Err, setB64Err] = useState<string | null>(null);

  // URL 状态
  const [urlIn, setUrlIn] = useState('https://example.com/路径?x=1');
  const [urlOut, setUrlOut] = useState('');
  const [urlErr, setUrlErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // HTML 状态
  const [htmlIn, setHtmlIn] = useState('<div class="box">文本 & 符号</div>');
  const [htmlOut, setHtmlOut] = useState('');

  const [copied, setCopied] = useState<string | null>(null);

  const flashCopied = (key: string) => {
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1200);
  };

  const copy = async (text: string, key: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      flashCopied(key);
    } catch {
      notify('复制失败', '浏览器拒绝访问剪贴板', 'error');
    }
  };

  // ---- Base64 ----
  const b64Encode = () => {
    try {
      setB64Out(utf8ToBase64(b64In));
      setB64Err(null);
    } catch {
      setB64Out('');
      setB64Err('编码失败（输入无法读取）');
    }
  };
  const b64Decode = () => {
    try {
      setB64Out(base64ToUtf8(b64In));
      setB64Err(null);
    } catch {
      setB64Out('');
      setB64Err('不是合法的 Base64 字符串');
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE) {
      notify('文件过大', `已限制为小于 ${MAX_FILE / 1024 / 1024}MB`, 'warn');
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      setB64In(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => notify('读取失败', file.name, 'error');
    reader.readAsDataURL(file);
  };

  // ---- URL ----
  const urlEncode = () => {
    try {
      setUrlOut(encodeURIComponent(urlIn));
      setUrlErr(null);
    } catch {
      setUrlErr('编码失败');
    }
  };
  const urlDecode = () => {
    try {
      setUrlOut(decodeURIComponent(urlIn));
      setUrlErr(null);
    } catch {
      setUrlErr('包含非法的转义序列');
    }
  };
  const parseQueryInput = () => {
    setQuery(urlIn);
  };

  // ---- HTML ----
  const htmlEscape = () => setHtmlOut(escapeHtml(htmlIn));
  const htmlUnescape = () => setHtmlOut(unescapeHtml(htmlIn));

  const tabs: Array<[Tab, string, ReactNode]> = [
    ['base64', 'Base64', <Binary key="b" size={13} />],
    ['url', 'URL 编码', <Link2 key="u" size={13} />],
    ['html', 'HTML 实体', <Code key="h" size={13} />],
  ];

  return (
    <div className="flex h-full flex-col bg-arch-bg text-arch-text">
      <div className="flex items-center gap-1 border-b border-arch-border bg-arch-panel/80 px-3 py-1.5">
        {tabs.map(([t, label, icon]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-1 text-xs',
              tab === t
                ? 'bg-arch-accent text-white'
                : 'bg-arch-panel hover:bg-white/10',
            )}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'base64' && (
          <div className="flex h-full flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={b64Encode}
                className="rounded bg-arch-accent px-2 py-1 text-xs text-white hover:opacity-90"
              >
                编码 →
              </button>
              <button
                type="button"
                onClick={b64Decode}
                className="rounded bg-arch-panel px-2 py-1 text-xs hover:bg-white/10"
              >
                ← 解码
              </button>
              <label className="flex cursor-pointer items-center gap-1 rounded bg-arch-panel px-2 py-1 text-xs hover:bg-white/10">
                <Upload size={13} /> 选择文件
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => onFile(e.target.files?.[0])}
                />
              </label>
              <button
                type="button"
                onClick={() => copy(b64Out, 'b64')}
                disabled={!b64Out}
                className="ml-auto flex items-center gap-1 rounded bg-arch-panel px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-40"
              >
                {copied === 'b64' ? <Check size={13} /> : <Copy size={13} />}
                复制
              </button>
            </div>
            <textarea
              value={b64In}
              onChange={(e) => setB64In(e.target.value)}
              spellCheck={false}
              placeholder="输入文本或 Base64…"
              className="min-h-[80px] flex-1 resize-none rounded border border-arch-border bg-black/30 p-2 font-mono text-[12px] leading-5 outline-none"
            />
            {b64Err && (
              <div className="flex items-center gap-1 text-xs text-arch-red">
                <AlertTriangle size={13} /> {b64Err}
              </div>
            )}
            <textarea
              value={b64Out}
              readOnly
              placeholder="结果…"
              className="min-h-[80px] flex-1 resize-none rounded border border-arch-border bg-black/30 p-2 font-mono text-[12px] leading-5 text-arch-green outline-none"
            />
          </div>
        )}

        {tab === 'url' && (
          <div className="flex h-full flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={urlEncode}
                className="rounded bg-arch-accent px-2 py-1 text-xs text-white hover:opacity-90"
              >
                编码 →
              </button>
              <button
                type="button"
                onClick={urlDecode}
                className="rounded bg-arch-panel px-2 py-1 text-xs hover:bg-white/10"
              >
                ← 解码
              </button>
              <button
                type="button"
                onClick={parseQueryInput}
                className="rounded bg-arch-panel px-2 py-1 text-xs hover:bg-white/10"
              >
                解析查询参数
              </button>
              <button
                type="button"
                onClick={() => copy(urlOut, 'url')}
                disabled={!urlOut}
                className="ml-auto flex items-center gap-1 rounded bg-arch-panel px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-40"
              >
                {copied === 'url' ? <Check size={13} /> : <Copy size={13} />}
                复制
              </button>
            </div>
            <textarea
              value={urlIn}
              onChange={(e) => setUrlIn(e.target.value)}
              spellCheck={false}
              placeholder="输入 URL 或查询字符串…"
              className="min-h-[70px] flex-1 resize-none rounded border border-arch-border bg-black/30 p-2 font-mono text-[12px] leading-5 outline-none"
            />
            {urlErr && (
              <div className="flex items-center gap-1 text-xs text-arch-red">
                <AlertTriangle size={13} /> {urlErr}
              </div>
            )}
            <textarea
              value={urlOut}
              readOnly
              placeholder="结果…"
              className="min-h-[70px] flex-1 resize-none rounded border border-arch-border bg-black/30 p-2 font-mono text-[12px] leading-5 text-arch-green outline-none"
            />
            {query.trim() !== '' && (
              <div className="rounded border border-arch-border bg-black/30 p-2">
                <div className="mb-1 text-[11px] text-arch-muted">查询参数表</div>
                <table className="w-full text-[12px]">
                  <tbody>
                    {parseQuery(query).map(([k, v], i) => (
                      <tr key={i} className="border-t border-arch-border/60">
                        <td className="py-0.5 pr-2 font-mono text-arch-accent">{k}</td>
                        <td className="py-0.5 font-mono text-arch-text">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'html' && (
          <div className="flex h-full flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={htmlEscape}
                className="rounded bg-arch-accent px-2 py-1 text-xs text-white hover:opacity-90"
              >
                转义 →
              </button>
              <button
                type="button"
                onClick={htmlUnescape}
                className="rounded bg-arch-panel px-2 py-1 text-xs hover:bg-white/10"
              >
                ← 反转义
              </button>
              <button
                type="button"
                onClick={() => copy(htmlOut, 'html')}
                disabled={!htmlOut}
                className="ml-auto flex items-center gap-1 rounded bg-arch-panel px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-40"
              >
                {copied === 'html' ? <Check size={13} /> : <Copy size={13} />}
                复制
              </button>
            </div>
            <textarea
              value={htmlIn}
              onChange={(e) => setHtmlIn(e.target.value)}
              spellCheck={false}
              placeholder="输入文本…"
              className="min-h-[80px] flex-1 resize-none rounded border border-arch-border bg-black/30 p-2 font-mono text-[12px] leading-5 outline-none"
            />
            <textarea
              value={htmlOut}
              readOnly
              placeholder="结果…"
              className="min-h-[80px] flex-1 resize-none rounded border border-arch-border bg-black/30 p-2 font-mono text-[12px] leading-5 text-arch-green outline-none"
            />
          </div>
        )}
      </div>
    </div>
  );
}
