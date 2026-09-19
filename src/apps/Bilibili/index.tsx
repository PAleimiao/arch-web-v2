import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Film,
  MessageSquareText,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';
import qrcode from 'qrcode-generator';

/* ----------------------------- 类型 ----------------------------- */

interface LoginResult {
  url?: string;
  qrcode_key?: string;
}

interface VideoCard {
  bvid: string;
  title: string;
  pic: string;
  owner?: { name?: string };
  /** 热门接口返回秒数，搜索接口返回 "mm:ss" */
  duration?: number | string;
  play?: number;
}

interface PageInfo {
  aid?: number;
  bvid?: string;
  title?: string;
  pic?: string;
  desc?: string;
  cid?: number;
  owner?: { name?: string; face?: string };
  pages?: Array<{ cid?: number; part?: string }>;
}

interface ReplyItem {
  rpid: string;
  member?: { uname?: string; avatar?: string };
  content?: { message?: string };
  like?: number;
}

interface DanmakuSource {
  text: string;
  time: number;
  color?: number;
  type?: number;
}

interface DanmakuSpawn extends DanmakuSource {
  key: number;
  lane: number;
}

interface UserProfile {
  uname?: string;
  face?: string;
}

const STORAGE_KEY = 'arch-web-bilibili-user';

/* ----------------------------- 工具 ----------------------------- */

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'include', ...init });
  if (!response.ok) {
    const text = await response.text();
    let message = text || `HTTP ${response.status}`;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? message;
    } catch {
      /* 保留原文 */
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

function collapseText(text?: string): string {
  return (text ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDuration(d?: number | string): string {
  if (typeof d === 'string') return d || '--:--';
  if (!d || d <= 0) return '--:--';
  const m = Math.floor(d / 60);
  const s = Math.floor(d % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatCount(n?: number): string {
  if (!n) return '0';
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(n);
}

function danmakuColor(color?: number): string {
  if (!color) return '#ffffff';
  return `#${color.toString(16).padStart(6, '0')}`;
}

/* ----------------------------- 主组件 ----------------------------- */

const DANMAKU_LANES = 6;
const DANMAKU_LIFETIME_MS = 6000;

export default function BilibiliApp(_: AppProps) {
  /* 登录 */
  const [user, setUser] = useState<UserProfile | null>(null);
  const [qrUrl, setQrUrl] = useState('');
  const [qrcodeKey, setQrcodeKey] = useState('');
  const [loginState, setLoginState] = useState<'idle' | 'waiting' | 'scanned' | 'confirmed' | 'error'>('idle');
  const [loginMessage, setLoginMessage] = useState('请使用二维码登录');

  /* 内容 */
  const [keyword, setKeyword] = useState('');
  const [listTitle, setListTitle] = useState('热门');
  const [cards, setCards] = useState<VideoCard[]>([]);
  const [listPage, setListPage] = useState(1);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const [selectedBvid, setSelectedBvid] = useState('');
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [replies, setReplies] = useState<ReplyItem[]>([]);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  /* 弹幕 */
  const [danmakuSource, setDanmakuSource] = useState<DanmakuSource[]>([]);
  const [showDanmaku, setShowDanmaku] = useState(true);
  const [spawns, setSpawns] = useState<DanmakuSpawn[]>([]);
  const lastTimeRef = useRef(0);
  const spawnSeqRef = useRef(0);
  const laneCursorRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const isLoggedIn = Boolean(user?.uname);

  /* ----------------------- 登录：二维码 ----------------------- */

  const loadUserInfo = useCallback(async () => {
    const nav = await fetchJson<{ code?: number; data?: UserProfile }>(
      '/api/bilibili/x/web-interface/nav',
    );
    if (nav.code === 0 && nav.data?.uname) return nav.data as UserProfile;
    return null;
  }, []);

  const saveUser = (next: UserProfile | null) => {
    setUser(next);
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
  };

  const generateQr = useCallback(async () => {
    setLoginState('waiting');
    setLoginMessage('正在生成二维码');
    try {
      const result = await fetchJson<{ code?: number; data?: LoginResult; message?: string }>(
        '/api/bilibili/passport/x/passport-login/web/qrcode/generate',
      );
      if (result.code !== 0 || !result.data?.url || !result.data?.qrcode_key) {
        throw new Error(result.message || '生成二维码失败');
      }
      const qr = qrcode(0, 'M');
      qr.addData(result.data.url);
      qr.make();
      setQrUrl(qr.createDataURL(8, 0));
      setQrcodeKey(result.data.qrcode_key);
      setLoginMessage('用手机 B 站客户端扫码');
    } catch (e) {
      setLoginState('error');
      setLoginMessage(e instanceof Error ? e.message : '生成二维码失败');
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn) void generateQr();
  }, [isLoggedIn, generateQr]);

  /* 轮询扫码状态：86101 未扫 86090 已扫待确认 0 成功 86038 过期 */
  useEffect(() => {
    if (!qrcodeKey || loginState === 'confirmed' || loginState === 'error') return;

    let alive = true;
    const poll = async () => {
      try {
        const result = await fetchJson<{ data?: { code?: number; message?: string } }>(
          `/api/bilibili/passport/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(qrcodeKey)}`,
        );
        if (!alive) return;
        const state = result.data?.code ?? -1;

        if (state === 86101) return;
        if (state === 86090) {
          setLoginState('scanned');
          setLoginMessage('已扫码，等待确认');
          return;
        }
        if (state === 0) {
          setLoginState('confirmed');
          setLoginMessage('登录成功');
          try {
            const profile = await loadUserInfo();
            if (profile) saveUser(profile);
          } catch {
            /* cookie 已在 Worker jar 里，拿不到资料也视为登录 */
          }
          return;
        }
        if (state === 86038) {
          setLoginState('error');
          setLoginMessage('二维码已过期，请刷新');
        }
      } catch {
        /* 网络抖动：下一轮继续 */
      }
    };

    const timer = window.setInterval(() => void poll(), 2000);
    void poll();
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [qrcodeKey, loginState, loadUserInfo]);

  const logout = () => {
    saveUser(null);
    setQrUrl('');
    setQrcodeKey('');
    setLoginState('idle');
    setLoginMessage('请使用二维码登录');
  };

  /* ----------------------- 内容：热门 / 搜索 ----------------------- */

  const loadPopular = useCallback(async (page: number, replace: boolean) => {
    setListLoading(true);
    setListError(null);
    try {
      const result = await fetchJson<{ code?: number; data?: { list?: VideoCard[] }; message?: string }>(
        `/api/bilibili/x/web-interface/popular?ps=20&pn=${page}`,
      );
      if (result.code !== 0) throw new Error(result.message || '热门列表获取失败');
      const list = (result.data?.list ?? []).filter((v) => v.bvid);
      setCards((prev) => (replace ? list : [...prev, ...list]));
      setListPage(page);
      setHasMore(list.length >= 20);
      if (replace) setListTitle('热门');
    } catch (e) {
      setListError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setListLoading(false);
    }
  }, []);

  const search = useCallback(async () => {
    const kw = keyword.trim();
    if (!kw) return;
    setListLoading(true);
    setListError(null);
    try {
      const result = await fetchJson<{ code?: number; data?: { result?: VideoCard[] }; message?: string }>(
        `/api/bilibili/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(kw)}&page=1&pagesize=20`,
      );
      if (result.code !== 0) throw new Error(result.message || '搜索失败');
      const list = (result.data?.result ?? []).filter((v) => v.bvid);
      setCards(list);
      setListPage(1);
      setHasMore(false);
      setListTitle(`搜索：${kw}`);
      if (list.length === 0) setListError('没有匹配的视频');
    } catch (e) {
      setListError(e instanceof Error ? e.message : '搜索失败');
    } finally {
      setListLoading(false);
    }
  }, [keyword]);

  /* 启动：先查登录态，再拉热门 */
  useEffect(() => {
    void (async () => {
      try {
        const cached = localStorage.getItem(STORAGE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as UserProfile;
          if (parsed.uname) {
            setUser(parsed);
            return;
          }
        }
        const profile = await loadUserInfo();
        if (profile) saveUser(profile);
      } catch {
        /* 未登录状态，走二维码 */
      }
    })();
  }, [loadUserInfo]);

  useEffect(() => {
    if (isLoggedIn) void loadPopular(1, true);
  }, [isLoggedIn, loadPopular]);

  /* ----------------------- 播放 ----------------------- */

  const loadVideo = useCallback(async (bvid: string) => {
    if (!bvid) return;
    setSelectedBvid(bvid);
    setVideoError(null);
    setVideoLoading(true);
    setPageInfo(null);
    setVideoUrl('');
    setReplies([]);
    setDanmakuSource([]);
    setSpawns([]);
    lastTimeRef.current = 0;

    try {
      const view = await fetchJson<{ code?: number; data?: PageInfo; message?: string }>(
        `/api/bilibili/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
      );
      if (view.code !== 0 || !view.data) throw new Error(view.message || '获取视频信息失败');
      const info = view.data;
      const cid = info.cid ?? info.pages?.[0]?.cid ?? 0;
      if (!cid) throw new Error('视频缺少 cid');

      // platform=html5 拿单文件 mp4（durl），浏览器 <video> 可直接播；
      // DASH（fnval=4048）是分离的音视频流，裸 <video> 播不了
      const play = await fetchJson<{
        code?: number;
        data?: { durl?: Array<{ url?: string; size?: number }> };
        message?: string;
      }>(
        `/api/bilibili/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${cid}&qn=80&platform=html5&high_quality=1`,
      );
      if (play.code !== 0) throw new Error(play.message || '获取播放地址失败');
      const raw = play.data?.durl?.[0]?.url;
      if (!raw) throw new Error('接口未返回播放地址');

      setPageInfo(info);
      setVideoUrl(`/api/bilibili/stream?url=${encodeURIComponent(raw)}`);

      // 评论：oid 是 aid 不是 cid
      if (info.aid) {
        try {
          const reply = await fetchJson<{ code?: number; data?: { replies?: ReplyItem[] } }>(
            `/api/bilibili/x/v2/reply?type=1&oid=${info.aid}&pn=1&ps=20&sort=1`,
          );
          if (reply.code === 0) setReplies(reply.data?.replies ?? []);
        } catch {
          /* 评论失败不阻塞播放 */
        }
      }

      // 弹幕
      try {
        const dm = await fetchJson<{ items?: DanmakuSource[] }>(`/api/bilibili/dm?cid=${cid}`);
        setDanmakuSource((dm.items ?? []).filter((d) => (d.type ?? 0) <= 3));
      } catch {
        /* 弹幕失败不阻塞播放 */
      }
    } catch (e) {
      setVideoError(e instanceof Error ? e.message : '加载视频失败');
    } finally {
      setVideoLoading(false);
    }
  }, []);

  /* ----------------------- 弹幕渲染 ----------------------- */

  const onTimeUpdate = (t: number) => {
    const prev = lastTimeRef.current;
    lastTimeRef.current = t;
    if (!showDanmaku || t <= prev || t - prev > 1) return;

    const incoming = danmakuSource.filter((d) => d.time > prev && d.time <= t);
    if (incoming.length === 0) return;

    const batch = incoming.slice(-12).map((d) => ({
      ...d,
      key: ++spawnSeqRef.current,
      lane: laneCursorRef.current++ % DANMAKU_LANES,
    }));

    setSpawns((s) => [...s.slice(-30), ...batch]);
    for (const item of batch) {
      window.setTimeout(() => {
        setSpawns((s) => s.filter((x) => x.key !== item.key));
      }, DANMAKU_LIFETIME_MS);
    }
  };

  const info = useMemo(() => {
    if (!pageInfo) return null;
    return {
      up: pageInfo.owner?.name ?? '',
      title: pageInfo.title ?? '',
      desc: collapseText(pageInfo.desc),
    };
  }, [pageInfo]);

  /* ----------------------- 未登录：扫码 ----------------------- */

  if (!isLoggedIn) {
    return (
      <div className="flex h-full items-center justify-center bg-arch-bg p-6 text-arch-text">
        <div className="w-full max-w-sm rounded-xl border border-arch-border bg-arch-panel/60 p-5">
          <div className="mb-4 flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-arch-accent/15 text-arch-accent">
              <Film size={18} />
            </div>
            <div>
              <h1 className="text-sm font-medium">哔哩哔哩</h1>
              <div className="text-[11px] text-arch-muted">扫码后使用搜索与播放</div>
            </div>
          </div>

          <div className="rounded-lg border border-arch-border bg-black/30 p-4">
            {qrUrl ? (
              <div className="flex flex-col items-center gap-3">
                <img src={qrUrl} alt="登录二维码" className="h-44 w-44 rounded bg-white p-2" />
                <div className="text-[11px] text-arch-muted">{loginMessage}</div>
              </div>
            ) : (
              <div className="flex h-44 items-center justify-center text-[11px] text-arch-muted">
                {loginState === 'error' ? loginMessage : '正在生成二维码'}
              </div>
            )}
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => void generateQr()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-arch-border px-3 py-2 text-xs hover:bg-white/5"
            >
              <RefreshCw size={12} /> 刷新二维码
            </button>
            <button
              type="button"
              onClick={() => {
                setLoginState('idle');
                setLoginMessage('请使用二维码登录');
              }}
              className="rounded-lg border border-arch-border px-3 py-2 text-xs text-arch-muted hover:bg-white/5"
            >
              重置
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ----------------------- 已登录：主界面 ----------------------- */

  return (
    <div className="flex h-full flex-col bg-arch-bg text-arch-text">
      {/* 顶栏：搜索 + 用户 */}
      <div className="flex items-center gap-3 border-b border-arch-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Film size={16} className="text-arch-accent" />
          <span className="text-sm font-medium">哔哩哔哩</span>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
          className="flex flex-1 items-center gap-2"
        >
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索视频（关键词或 BV 号）"
            className="w-full max-w-md rounded-lg border border-arch-border bg-black/30 px-3 py-1.5 text-xs outline-none focus:border-arch-accent"
          />
          <button
            type="submit"
            disabled={listLoading}
            className="flex items-center gap-1 rounded-lg border border-arch-border px-2.5 py-1.5 text-xs hover:bg-white/5 disabled:opacity-50"
          >
            <Search size={12} /> 搜索
          </button>
          {listTitle !== '热门' && (
            <button
              type="button"
              onClick={() => {
                setKeyword('');
                void loadPopular(1, true);
              }}
              className="rounded-lg border border-arch-border px-2.5 py-1.5 text-xs text-arch-muted hover:bg-white/5"
            >
              返回热门
            </button>
          )}
        </form>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-arch-border px-2 py-1">
            <div className="h-5 w-5 overflow-hidden rounded-full bg-white/10">
              {user?.face ? <img src={user.face} alt="" className="h-full w-full object-cover" /> : null}
            </div>
            <span className="max-w-24 truncate text-[11px]">{user?.uname}</span>
          </div>
          <button
            type="button"
            onClick={logout}
            className="rounded-lg border border-arch-border px-2 py-1 text-[11px] text-arch-muted hover:bg-white/5"
          >
            切换账号
          </button>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-[300px_minmax(0,1fr)] overflow-hidden">
        {/* 左：视频列表 */}
        <aside className="flex min-h-0 flex-col border-r border-arch-border">
          <div className="flex items-center justify-between border-b border-arch-border px-3 py-2 text-[11px] text-arch-muted">
            <span className="truncate">{listTitle} · {cards.length}</span>
            {listLoading && <span>加载中…</span>}
          </div>

          <div className="flex-1 overflow-y-auto">
            {cards.map((item) => (
              <button
                type="button"
                key={item.bvid}
                onClick={() => void loadVideo(item.bvid)}
                className={cn(
                  'flex w-full gap-2.5 border-b border-arch-border/40 p-2.5 text-left transition hover:bg-white/5',
                  selectedBvid === item.bvid && 'bg-arch-accent/10',
                )}
              >
                <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded bg-black/40">
                  {item.pic ? (
                    <img src={item.pic} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : null}
                  <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[9px] tabular-nums text-white">
                    {formatDuration(item.duration)}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-[12px] leading-snug">{collapseText(item.title)}</div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-arch-muted">
                    <span className="truncate">{item.owner?.name}</span>
                    {item.play != null && <span>{formatCount(item.play)} 播放</span>}
                  </div>
                </div>
              </button>
            ))}

            {listError && (
              <div className="p-3 text-[11px] leading-relaxed text-arch-red">{listError}</div>
            )}

            {cards.length > 0 && hasMore && listTitle === '热门' && (
              <button
                type="button"
                onClick={() => void loadPopular(listPage + 1, false)}
                disabled={listLoading}
                className="w-full py-2.5 text-[11px] text-arch-muted hover:bg-white/5 disabled:opacity-50"
              >
                加载更多
              </button>
            )}
          </div>
        </aside>

        {/* 右：播放器 + 信息 + 评论 */}
        <main className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-3">
            {/* 播放器 */}
            <div className="relative overflow-hidden rounded-lg border border-arch-border bg-black">
              {videoUrl ? (
                <video
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  playsInline
                  className="aspect-video w-full bg-black"
                  onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
                  onError={() => setVideoError('视频流加载失败，可能已被下架或稍后重试')}
                />
              ) : (
                <div className="flex aspect-video items-center justify-center text-xs text-arch-muted">
                  {videoLoading ? '加载中…' : videoError ?? '从左侧选择视频'}
                </div>
              )}

              {/* 弹幕层 */}
              {showDanmaku && videoUrl && (
                <div className="pointer-events-none absolute inset-0 overflow-hidden">
                  {spawns.map((d) => (
                    <span
                      key={d.key}
                      className="absolute whitespace-nowrap text-[12px] font-medium"
                      style={{
                        top: `${(d.lane * 14 + 4)}%`,
                        left: '100%',
                        animation: `bili-dm ${DANMAKU_LIFETIME_MS / 1000}s linear forwards`,
                        color: danmakuColor(d.color),
                        textShadow: '0 0 3px rgba(0,0,0,0.8)',
                      }}
                    >
                      {d.text}
                    </span>
                  ))}
                </div>
              )}

              {videoError && videoUrl && (
                <div className="absolute inset-x-3 top-3 flex items-center gap-2 rounded border border-arch-red/50 bg-black/85 p-2 text-[11px] text-arch-red">
                  <X size={12} className="shrink-0" />
                  <span className="flex-1">{videoError}</span>
                </div>
              )}
            </div>

            {/* 标题栏 */}
            <div className="mt-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{info?.title || '未选择视频'}</div>
                <div className="mt-0.5 text-[11px] text-arch-muted">
                  {info?.up ? `UP 主：${info.up}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDanmaku((v) => !v)}
                className={cn(
                  'shrink-0 rounded-lg border px-2.5 py-1 text-[11px] transition',
                  showDanmaku
                    ? 'border-arch-accent bg-arch-accent/15 text-arch-accent'
                    : 'border-arch-border text-arch-muted hover:bg-white/5',
                )}
              >
                弹幕{showDanmaku ? '开' : '关'}
              </button>
            </div>

            {info?.desc && (
              <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-arch-muted">{info.desc}</p>
            )}

            {/* 评论 */}
            <div className="mt-4">
              <div className="mb-2 flex items-center gap-1.5 text-xs">
                <MessageSquareText size={13} className="text-arch-muted" />
                评论 {replies.length > 0 && `· ${replies.length}`}
              </div>
              {replies.length === 0 ? (
                <div className="rounded-lg border border-dashed border-arch-border p-4 text-center text-[11px] text-arch-muted">
                  {pageInfo ? '暂无评论' : '选择视频后显示评论'}
                </div>
              ) : (
                <div className="space-y-2">
                  {replies.map((r) => (
                    <div key={r.rpid} className="rounded-lg border border-arch-border/60 p-2.5">
                      <div className="mb-1 flex items-center gap-2">
                        <div className="h-5 w-5 overflow-hidden rounded-full bg-white/10">
                          {r.member?.avatar ? (
                            <img src={r.member.avatar} alt="" loading="lazy" className="h-full w-full object-cover" />
                          ) : null}
                        </div>
                        <span className="text-[11px] font-medium">{r.member?.uname || '用户'}</span>
                        {r.like ? <span className="text-[10px] text-arch-muted">{r.like} 赞</span> : null}
                      </div>
                      <p className="text-[12px] leading-relaxed text-arch-muted">
                        {collapseText(r.content?.message)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      <style>{`
        @keyframes bili-dm {
          0% { transform: translateX(0); opacity: 0.9; }
          95% { opacity: 0.9; }
          100% { transform: translateX(calc(-100% - 100vw / 2)); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
