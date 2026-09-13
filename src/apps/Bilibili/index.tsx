import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Film,
  MessageSquareText,
  Play,
  QrCode,
  Search,
  Sparkles,
  Video,
  Volume2,
  X,
} from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';
import qrcode from 'qrcode-generator';

interface LoginResult {
  url?: string;
  qrcode_key?: string;
}

interface PageInfo {
  title?: string;
  pic?: string;
  owner?: { name?: string; face?: string };
  desc?: string;
  bvid?: string;
  cid?: number;
  pages?: Array<{ cid?: number; part?: string }>;
}

interface SearchItem {
  bvid?: string;
  title?: string;
  pic?: string;
  owner?: { name?: string };
  duration?: string;
}

interface ReplyItem {
  rpid: string;
  member?: { uname?: string; avatar?: string };
  content?: { message?: string };
  like?: number;
}

interface DanmakuItem {
  text: string;
  time: number;
  color?: number;
}

interface UserProfile {
  uname?: string;
  face?: string;
}

const STORAGE_KEY = 'arch-web-bilibili-user';

const FALLBACK_SEARCH = 'BV1xx411c7mD';

const HOME_TABS = ['推荐', '番剧', '直播', '游戏', '影视'] as const;
type HomeTab = (typeof HOME_TABS)[number];

const FEATURED_ITEMS: Array<SearchItem & { description: string; tag: string }> = [
  {
    bvid: 'BV1xx411c7mD',
    title: '入站必刷：这才是你真正需要的 B 站首页玩法',
    pic: 'https://picsum.photos/seed/bili-feature-1/320/180',
    owner: { name: 'Bilibili 热门推荐' },
    duration: '08:24',
    description: '适合第一次打开应用时快速上手的精选视频内容。',
    tag: '推荐',
  },
  {
    bvid: 'BV1Yt411D7A3',
    title: '高质量动画与番剧：适合放松的精选合集',
    pic: 'https://picsum.photos/seed/bili-feature-2/320/180',
    owner: { name: 'UP 主精选' },
    duration: '26:15',
    description: '轻松、短平快的内容，适合在休息时刷一刷。',
    tag: '番剧',
  },
  {
    bvid: 'BV1GJ411x7hS',
    title: '实用技巧与高效工具：提升日常效率',
    pic: 'https://picsum.photos/seed/bili-feature-3/320/180',
    owner: { name: '效率课堂' },
    duration: '16:08',
    description: '实用内容集合，适合想快速获得帮助的场景。',
    tag: '实用',
  },
  {
    bvid: 'BV1fA411D7La',
    title: '音乐与生活：轻松节奏的精选内容',
    pic: 'https://picsum.photos/seed/bili-feature-4/320/180',
    owner: { name: '生活精选' },
    duration: '11:42',
    description: '来自生活与音乐方向的轻松内容，入口很适合刷一刷。',
    tag: '生活',
  },
];

const HOME_FEED: Record<HomeTab, Array<SearchItem & { description: string; tag: string }>> = {
  推荐: FEATURED_ITEMS,
  番剧: [
    { bvid: 'BV1Qx411c7mQ', title: '新番速看：轻松上线的治愈系推荐', pic: 'https://picsum.photos/seed/bili-anime-1/320/180', owner: { name: '追番日记' }, duration: '24:11', description: '适合在闲暇时放松的番剧精选内容。', tag: '追番' },
    { bvid: 'BV1pK411n7hN', title: '热血开局：充满张力的年度作品盘点', pic: 'https://picsum.photos/seed/bili-anime-2/320/180', owner: { name: '番剧馆' }, duration: '18:03', description: '适合想快速选一部新番的你。', tag: '新番' },
    { bvid: 'BV1bJ411V7mF', title: '日常治愈与温柔系番剧混剪', pic: 'https://picsum.photos/seed/bili-anime-3/320/180', owner: { name: '温柔精选' }, duration: '09:40', description: '没事刷一刷，心情会舒服很多。', tag: '治愈' },
    { bvid: 'BV1iW411M7hE', title: '视觉与故事并重的高质量动画推荐', pic: 'https://picsum.photos/seed/bili-anime-4/320/180', owner: { name: '动画精选' }, duration: '14:26', description: '适合追番时看一眼，挑选方向会更明确。', tag: '精选' },
  ],
  直播: [
    { bvid: 'BV1rA411K7v8', title: '直播间热聊：今天最值得关注的精彩内容', pic: 'https://picsum.photos/seed/bili-live-1/320/180', owner: { name: '直播精选' }, duration: '42:18', description: '高能氛围和持续更新的内容入口。', tag: '直播' },
    { bvid: 'BV1v64y1F7Z6', title: '游戏直播：适合打发时间的高能现场', pic: 'https://picsum.photos/seed/bili-live-2/320/180', owner: { name: '电竞直播' }, duration: '31:04', description: '看一眼很容易就停不下来的组播感。', tag: '电竞' },
    { bvid: 'BV13g411Y7M4', title: '音乐现场：多人在线的轻松氛围直播', pic: 'https://picsum.photos/seed/bili-live-3/320/180', owner: { name: '音乐直播' }, duration: '28:52', description: '适合边做事边开着听的内容。', tag: '音乐' },
    { bvid: 'BV1Rr4y1W7b5', title: '聊天与吐槽：轻松休闲的弹幕互动内容', pic: 'https://picsum.photos/seed/bili-live-4/320/180', owner: { name: '日常直播' }, duration: '23:46', description: '氛围感很强，适合刷一下放松。', tag: '聊天' },
  ],
  游戏: [
    { bvid: 'BV1Mm4y1d7vN', title: '高质量游戏开箱：推荐给喜欢尝鲜的人', pic: 'https://picsum.photos/seed/bili-game-1/320/180', owner: { name: '游戏精选' }, duration: '12:40', description: '适合想找新游戏的你快速筛选。', tag: '开箱' },
    { bvid: 'BV1Tg411Y7Lr', title: '游戏速通：高效率的挑战与收获', pic: 'https://picsum.photos/seed/bili-game-2/320/180', owner: { name: '敢玩游戏' }, duration: '15:32', description: '看一眼就能发现自己喜欢的玩法。', tag: '速通' },
    { bvid: 'BV1oM4y1d7Db', title: '单机与联机：适合多人一起玩的内容', pic: 'https://picsum.photos/seed/bili-game-3/320/180', owner: { name: '游戏生活' }, duration: '17:08', description: '适合想有点节奏地刷内容时打开。', tag: '联机' },
    { bvid: 'BV1XT4y1r7m7', title: '游戏剧情解析：让你更容易选对作品', pic: 'https://picsum.photos/seed/bili-game-4/320/180', owner: { name: '剧情站' }, duration: '10:22', description: '如果你想看点更有层次的内容，这里很适合。', tag: '解析' },
  ],
  影视: [
    { bvid: 'BV1kV4y1x7AH', title: '电影精选：适合一口气刷一批的电影区', pic: 'https://picsum.photos/seed/bili-film-1/320/180', owner: { name: '影视精选' }, duration: '19:44', description: '配合晚上刷片的节奏非常顺手。', tag: '电影' },
    { bvid: 'BV1vE411d7zY', title: '经典影视盘点：值得回味的作品推荐', pic: 'https://picsum.photos/seed/bili-film-2/320/180', owner: { name: '影评站' }, duration: '13:56', description: '你可以从这里快速找到自己想看的风格。', tag: '盘点' },
    { bvid: 'BV1zM4y1m7ry', title: '综艺与小片：轻松、有趣的日常内容', pic: 'https://picsum.photos/seed/bili-film-3/320/180', owner: { name: '综艺精选' }, duration: '21:11', description: '适合在休息时切换到放松模式。', tag: '综艺' },
    { bvid: 'BV1Sv4y1V7UQ', title: '收藏级、高品质影视短评', pic: 'https://picsum.photos/seed/bili-film-4/320/180', owner: { name: '片单精选' }, duration: '07:58', description: '速览式内容，尤其适合第一次入站。', tag: '短评' },
  ],
};

const HERO_ITEMS = [
  {
    title: '入站必刷',
    subtitle: '精选内容 · 轻松上手 · 一口气刷到爽',
    pic: 'https://picsum.photos/seed/bili-hero-1/900/360',
    color: 'from-pink-500 via-fuchsia-500 to-rose-500',
  },
  {
    title: '番剧推荐',
    subtitle: '质量优先 · 治愈系 · 每天都有新内容',
    pic: 'https://picsum.photos/seed/bili-hero-2/900/360',
    color: 'from-violet-500 via-purple-500 to-pink-500',
  },
  {
    title: '直播热聊',
    subtitle: '打开就能看 · 气氛感与弹幕互动更强',
    pic: 'https://picsum.photos/seed/bili-hero-3/900/360',
    color: 'from-cyan-500 via-sky-500 to-indigo-500',
  },
];

const QUICK_CHANNELS = [
  { name: '动态', icon: '◆' },
  { name: '热门', icon: '★' },
  { name: '番剧', icon: '▣' },
  { name: '游戏', icon: '◈' },
  { name: '音乐', icon: '♫' },
  { name: '影视', icon: '◍' },
  { name: '知识', icon: '✦' },
  { name: '生活', icon: '☼' },
];

const QUICK_ACTIONS = [
  { label: '我的收藏', value: '12', hint: '已保存视频' },
  { label: '历史记录', value: '27', hint: '最近播放' },
  { label: '追番进度', value: '4', hint: '待更新' },
  { label: '下载管理', value: '6', hint: '离线内容' },
];

const HOT_TOPICS = [
  { title: '入站必刷', count: '2.1万' },
  { title: '番剧新作', count: '1.3万' },
  { title: '直播热聊', count: '8.7千' },
  { title: '游戏速通', count: '9.4千' },
];

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

function normalizeMessage(text?: string): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

export default function BilibiliApp(_: AppProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [qrUrl, setQrUrl] = useState<string>('');
  const [qrcodeKey, setQrcodeKey] = useState<string>('');
  const [loginState, setLoginState] = useState<'idle' | 'waiting' | 'scanned' | 'confirmed' | 'error'>('idle');
  const [loginMessage, setLoginMessage] = useState('请使用二维码登录');

  const [keyword, setKeyword] = useState(FALLBACK_SEARCH);
  const [activeTab, setActiveTab] = useState<HomeTab>('推荐');
  const [heroIndex, setHeroIndex] = useState(0);
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
  const [selectedBvid, setSelectedBvid] = useState<string>('');
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [replies, setReplies] = useState<ReplyItem[]>([]);
  const [danmaku, setDanmaku] = useState<DanmakuItem[]>([]);
  const [showDanmaku, setShowDanmaku] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleDanmaku = useMemo(() => {
    if (!showDanmaku || danmaku.length === 0) return [];
    return danmaku
      .filter((item) => item.time >= currentTime - 0.5 && item.time <= currentTime + 4.5)
      .slice(0, 18);
  }, [currentTime, danmaku, showDanmaku]);

  const activeFeed = useMemo(() => HOME_FEED[activeTab], [activeTab]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setHeroIndex((prev) => (prev + 1) % HERO_ITEMS.length);
    }, 4500);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (!cached) return;

    try {
      const parsed = JSON.parse(cached) as UserProfile;
      if (parsed.uname) {
        setUser(parsed);
        setIsLoggedIn(true);
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const saveUser = (nextUser: UserProfile | null) => {
    setUser(nextUser);
    setIsLoggedIn(Boolean(nextUser?.uname));

    if (!nextUser) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextUser));
  };

  const generateQr = async () => {
    setError(null);
    setLoginState('waiting');
    setLoginMessage('正在生成二维码...');

    try {
      const result = await fetchJson<{ code?: number; data?: LoginResult; message?: string }>(
        '/api/bilibili/passport/x/passport-login/web/qrcode/generate',
      );

      if (result.code !== 0 || !result.data?.qrcode_key || !result.data.url) {
        throw new Error(result.message || '生成二维码失败');
      }

      const qr = qrcode(0, 'M');
      qr.addData(result.data.url);
      qr.make();
      setQrUrl(qr.createDataURL(8, 0));
      setQrcodeKey(result.data.qrcode_key);
      setLoginMessage('请用手机扫码登录');
    } catch (e) {
      const message = e instanceof Error ? e.message : '生成二维码失败';
      setLoginState('error');
      setLoginMessage(message);
      setError(message);
    }
  };

  useEffect(() => {
    if (!qrcodeKey || loginState === 'idle' || loginState === 'error' || loginState === 'confirmed') return;

    const poll = async () => {
      try {
        // 新版扫码接口：data.code 86101=未扫码 86090=已扫码未确认 86038=已失效 0=成功
        const result = await fetchJson<{ code?: number; data?: { code?: number; url?: string; message?: string } }>(
          `/api/bilibili/passport/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(qrcodeKey)}`,
        );

        const state = result.data?.code ?? -1;

        if (state === 86101) {
          setLoginMessage('等待扫码...');
          return;
        }

        if (state === 86090) {
          setLoginState('scanned');
          setLoginMessage('已扫码，等待确认');
          return;
        }

        if (state === 0) {
          setLoginState('confirmed');
          setLoginMessage('扫码确认成功，正在同步账号信息');

          try {
            const nav = await fetchJson<{ data?: UserProfile }>(
              '/api/bilibili/x/web-interface/nav',
            );

            const nextUser = {
              uname: nav.data?.uname || '已登录用户',
              face: nav.data?.face || '',
            };

            saveUser(nextUser);
            setLoginState('confirmed');
            setLoginMessage('登录成功');
          } catch {
            setLoginMessage('已确认登录，但获取用户信息失败');
          }

          return;
        }

        setLoginState('error');
        setLoginMessage(state === 86038 ? '二维码已过期，请重新生成' : result.data?.message || '登录失败');
      } catch (e) {
        setLoginState('error');
        const message = e instanceof Error ? e.message : '二维码状态查询失败';
        setLoginMessage(message);
      }
    };

    const timer = setInterval(() => {
      void poll();
    }, 2000);

    void poll();

    return () => clearInterval(timer);
  }, [loginState, qrcodeKey]);

  useEffect(() => {
    if (!isLoggedIn) {
      void generateQr();
    }
  }, [isLoggedIn]);

  const searchVideo = async () => {
    const trimmed = keyword.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    try {
      const result = await fetchJson<{
        code?: number;
        data?: { result?: SearchItem[] };
        message?: string;
      }>(`/api/bilibili/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(trimmed)}&page=1&pagesize=10`);

      if (result.code !== 0) {
        throw new Error(result.message || '搜索失败');
      }

      const items = result.data?.result ?? [];
      setSearchResults(items);
      if (items[0]?.bvid) {
        setSelectedBvid(items[0].bvid);
        void loadVideo(items[0].bvid);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : '搜索失败';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const loadVideo = async (bvid: string) => {
    setSelectedBvid(bvid);
    setError(null);
    setLoading(true);

    try {
      const viewResult = await fetchJson<{
        code?: number;
        data?: PageInfo;
        message?: string;
      }>(`/api/bilibili/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`);

      if (viewResult.code !== 0 || !viewResult.data) {
        throw new Error(viewResult.message || '获取视频信息失败');
      }

      const info = viewResult.data;
      const cid = info.cid ?? info.pages?.[0]?.cid ?? 0;

      const playUrlResult = await fetchJson<{
        code?: number;
        data?: {
          durl?: Array<{ url?: string }>;
          dash?: {
            video?: Array<{ base_url?: string }>;
            audio?: Array<{ base_url?: string }>;
          };
        };
        message?: string;
      }>(`/api/bilibili/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${cid}&qn=80&fnval=4048&fourk=1`);

      if (playUrlResult.code !== 0) {
        throw new Error(playUrlResult.message || '获取播放地址失败');
      }

      const url =
        playUrlResult.data?.durl?.[0]?.url ||
        playUrlResult.data?.dash?.video?.[0]?.base_url ||
        playUrlResult.data?.dash?.audio?.[0]?.base_url ||
        '';

      if (!url) {
        throw new Error('接口返回了空播放地址');
      }

      setPageInfo(info);
      setVideoUrl(url);

      const commentsResult = await fetchJson<{
        code?: number;
        data?: { replies?: ReplyItem[] };
        message?: string;
      }>(`/api/bilibili/x/v2/reply?type=1&oid=${cid}&pn=1&sort=0`);

      if (commentsResult.code === 0) {
        setReplies(commentsResult.data?.replies ?? []);
      }

      const dmResult = await fetchJson<{ items?: DanmakuItem[] }>(`/api/bilibili/dm?cid=${cid}`);
      setDanmaku(dmResult.items ?? []);
    } catch (e) {
      const message = e instanceof Error ? e.message : '加载视频失败';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    saveUser(null);
    setQrUrl('');
    setOauthKey('');
    setLoginState('idle');
    setLoginMessage('请使用二维码登录');
    setSearchResults([]);
    setSelectedBvid('');
    setPageInfo(null);
    setVideoUrl('');
    setReplies([]);
    setDanmaku([]);
    setCurrentTime(0);
    setError(null);
  };

  const handleVideoLoaded = () => {
    if (videoRef.current) {
      videoRef.current.volume = 0.9;
      void videoRef.current.play().catch(() => {
        // ignore autoplay restrictions in this demo build
      });
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_top,#f8fafc,#eef2f7_45%,#e5e7eb)] p-6 text-slate-800">
        <div className="w-full max-w-md rounded-[28px] border border-slate-200 bg-white/90 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-pink-100 text-pink-600">
              <Film size={22} />
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Bilibili</div>
              <h1 className="text-xl font-semibold">哔哩哔哩</h1>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            {qrUrl ? (
              <div className="flex flex-col items-center gap-3">
                <img src={qrUrl} alt="二维码登录" className="h-52 w-52 rounded-xl border border-slate-200 bg-white p-2" />
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <QrCode size={16} className="text-pink-500" />
                  <span>{loginMessage}</span>
                </div>
              </div>
            ) : (
              <div className="flex h-52 items-center justify-center text-sm text-slate-500">
                正在生成二维码...
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => void generateQr()}
              className="flex-1 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700"
            >
              刷新二维码
            </button>
            <button
              type="button"
              onClick={() => setLoginState('idle')}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              重新开始
            </button>
          </div>

          {error ? (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-slate-100 text-slate-800">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pink-100 text-pink-600">
            <Film size={20} />
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-slate-500">Bilibili</div>
            <h1 className="text-base font-semibold">哔哩哔哩</h1>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
            <Sparkles size={14} className="text-pink-500" />
            {loginMessage}
          </div>
          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1.5">
            <div className="h-7 w-7 overflow-hidden rounded-full bg-slate-200">
              {user?.face ? (
                <img src={user.face} alt={user.uname || '用户'} className="h-full w-full object-cover" />
              ) : null}
            </div>
            <div className="text-left">
              <div className="text-[10px] text-slate-400">已登录</div>
              <div className="text-xs font-medium text-slate-700">{user?.uname || '用户'}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
          >
            切换账号
          </button>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-[280px_minmax(0,1fr)] overflow-hidden">
        <aside className="border-r border-slate-200 bg-slate-50/90 p-3">
          {user ? (
            <div className="mb-3 rounded-[22px] bg-gradient-to-r from-pink-500 to-fuchsia-500 p-[1px] shadow-sm">
              <div className="rounded-[21px] bg-white/95 p-3">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 overflow-hidden rounded-full border border-slate-200 bg-slate-100">
                    {user.face ? (
                      <img src={user.face} alt={user.uname || '用户'} className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-700">{user.uname || '用户'}</div>
                    <div className="text-[11px] text-slate-500">已登录 · 个人中心</div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="mb-3 rounded-[22px] border border-pink-100 bg-gradient-to-br from-pink-50 to-white p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-700">入站必刷</div>
              <div className="rounded-full bg-pink-100 px-2 py-0.5 text-[10px] font-medium text-pink-600">今日推荐</div>
            </div>
            <div className="space-y-2">
              {FEATURED_ITEMS.map((item) => (
                <button
                  key={item.bvid}
                  type="button"
                  onClick={() => void loadVideo(item.bvid || '')}
                  className="flex w-full items-center gap-2 rounded-2xl border border-white bg-white/80 p-2 text-left shadow-sm transition hover:border-pink-200 hover:bg-pink-50"
                >
                  <div className="relative h-14 w-20 overflow-hidden rounded-xl bg-slate-200">
                    <img src={item.pic} alt={item.title} className="h-full w-full object-cover" />
                    <div className="absolute bottom-1 right-1 rounded bg-slate-900/70 px-1 py-0.5 text-[9px] text-white">
                      {item.duration}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-[12px] font-medium text-slate-700">{item.title}</div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-500">
                      <span>{item.owner?.name}</span>
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-600">{item.tag}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="mb-3 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="输入 BV 号或关键词"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
            <button
              type="button"
              onClick={() => void searchVideo()}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white transition hover:bg-slate-700"
            >
              <Search size={15} />
            </button>
          </div>

          <div className="space-y-2 overflow-y-auto pb-3">
            {searchResults.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-4 text-sm text-slate-500">
                先搜索视频，再点开播放
              </div>
            ) : (
              searchResults.map((item) => (
                <button
                  type="button"
                  key={item.bvid}
                  onClick={() => void loadVideo(item.bvid || '')}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-2xl border bg-white p-2 text-left shadow-sm transition',
                    selectedBvid === item.bvid
                      ? 'border-pink-200 bg-pink-50'
                      : 'border-slate-200 hover:border-slate-300',
                  )}
                >
                  <div className="relative h-20 w-28 overflow-hidden rounded-xl bg-slate-200">
                    {item.pic ? (
                      <img src={item.pic} alt={item.title} className="h-full w-full object-cover" />
                    ) : null}
                    <div className="absolute bottom-1 right-1 rounded bg-slate-900/75 px-1.5 py-0.5 text-[10px] text-white">
                      {item.duration || '视频'}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-sm font-medium text-slate-700">{item.title || '未知标题'}</div>
                    <div className="mt-1 text-[11px] text-slate-500">{item.owner?.name || '未知UP主'}</div>
                    <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
                      <Play size={11} />
                      {item.bvid}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <main className="flex min-h-0 flex-col gap-4 overflow-hidden p-4">
          <div className="rounded-[24px] border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-3 overflow-hidden rounded-[20px] bg-slate-100">
              <div
                className={cn(
                  'relative h-36 w-full overflow-hidden rounded-[20px] bg-gradient-to-r',
                  HERO_ITEMS[heroIndex].color,
                )}
              >
                <img
                  src={HERO_ITEMS[heroIndex].pic}
                  alt={HERO_ITEMS[heroIndex].title}
                  className="absolute inset-0 h-full w-full object-cover opacity-60"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-slate-900/70 via-slate-900/35 to-transparent" />
                <div className="relative flex h-full items-end p-4">
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-[0.22em] text-pink-100">首页推荐</div>
                    <div className="text-xl font-semibold text-white">{HERO_ITEMS[heroIndex].title}</div>
                    <div className="mt-1 text-xs text-slate-200">{HERO_ITEMS[heroIndex].subtitle}</div>
                  </div>
                </div>
                <div className="absolute bottom-3 right-3 flex gap-1.5">
                  {HERO_ITEMS.map((item, index) => (
                    <button
                      key={item.title}
                      type="button"
                      onClick={() => setHeroIndex(index)}
                      className={cn(
                        'h-2 w-6 rounded-full transition',
                        heroIndex === index ? 'bg-white' : 'bg-white/40',
                      )}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="mb-4 grid grid-cols-4 gap-2">
              {QUICK_CHANNELS.map((channel) => (
                <button
                  key={channel.name}
                  type="button"
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-2 py-3 text-center text-[11px] font-medium text-slate-600 transition hover:border-pink-200 hover:bg-pink-50 hover:text-pink-600"
                >
                  <div className="mb-1 text-base">{channel.icon}</div>
                  {channel.name}
                </button>
              ))}
            </div>

            <div className="mb-4 grid grid-cols-4 gap-3">
              {QUICK_ACTIONS.map((action) => (
                <div
                  key={action.label}
                  className="rounded-[20px] border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{action.label}</div>
                  <div className="mt-2 text-xl font-semibold text-slate-700">{action.value}</div>
                  <div className="mt-1 text-[10px] text-slate-500">{action.hint}</div>
                </div>
              ))}
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2">
              {HOME_TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs font-medium transition',
                    activeTab === tab
                      ? 'bg-pink-500 text-white shadow-sm'
                      : 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100',
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="mb-4 grid grid-cols-2 gap-3">
              {HOT_TOPICS.map((topic) => (
                <div
                  key={topic.title}
                  className="rounded-[20px] border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">热门话题</div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-700">#{topic.title}</span>
                    <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] text-slate-600">{topic.count}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {activeFeed.map((item) => (
                <button
                  key={`${activeTab}-${item.bvid}`}
                  type="button"
                  onClick={() => void loadVideo(item.bvid || '')}
                  className="overflow-hidden rounded-[20px] border border-slate-200 bg-slate-50 text-left transition hover:border-pink-200 hover:bg-pink-50"
                >
                  <div className="relative h-28 w-full overflow-hidden bg-slate-200">
                    <img src={item.pic} alt={item.title} className="h-full w-full object-cover" />
                    <div className="absolute bottom-2 right-2 rounded bg-slate-900/75 px-1.5 py-0.5 text-[10px] text-white">
                      {item.duration}
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="line-clamp-2 text-sm font-medium text-slate-700">{item.title}</div>
                    <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
                      <span>{item.owner?.name}</span>
                      <span className="rounded-full bg-white px-1.5 py-0.5 text-[9px] text-slate-600">{item.tag}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Video size={16} className="text-pink-500" />
                <span>{pageInfo?.title || '暂无视频'}</span>
              </div>
              <button
                type="button"
                onClick={() => setShowDanmaku((prev) => !prev)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-medium transition',
                  showDanmaku
                    ? 'bg-pink-500 text-white'
                    : 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100',
                )}
              >
                {showDanmaku ? '关闭弹幕' : '打开弹幕'}
              </button>
            </div>

            <div className="relative overflow-hidden rounded-[20px] border border-slate-200 bg-black shadow-inner">
              {videoUrl ? (
                <>
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    controls
                    crossOrigin="anonymous"
                    className="aspect-video h-full w-full bg-black"
                    onLoadedData={handleVideoLoaded}
                    onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                    onError={() => setError('当前视频流无法播放，请尝试切换其他视频或稍后再试')}
                  />

                  {showDanmaku ? (
                    <div className="pointer-events-none absolute inset-0 overflow-hidden">
                      {visibleDanmaku.map((item, index) => (
                        <span
                          key={`${item.time}-${index}`}
                          className="absolute whitespace-nowrap text-[11px] font-medium text-white drop-shadow-[0_0_4px_rgba(15,23,42,0.8)]"
                          style={{
                            top: `${(index * 16) % 72 + 10}%`,
                            left: '100%',
                            animation: 'bili-dm 5s linear forwards',
                            color: item.color ? `#${item.color.toString(16).padStart(6, '0')}` : '#ffffff',
                          }}
                        >
                          {item.text}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="flex aspect-video items-center justify-center bg-slate-900 text-sm text-slate-300">
                  {loading ? '加载中...' : '还没有视频源'}
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <CheckCircle2 size={15} className="text-emerald-500" />
                <span>{pageInfo?.owner?.name || '未加载视频'}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Volume2 size={15} />
                <span>默认音量 0.9</span>
              </div>
            </div>
          </div>

          <div className="grid flex-1 grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)] gap-4 overflow-hidden">
            <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
                <MessageSquareText size={16} className="text-pink-500" />
                评论区
              </div>

              <div className="space-y-3 overflow-y-auto pr-1">
                {replies.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                    视频加载后会显示评论列表
                  </div>
                ) : (
                  replies.map((reply) => (
                    <div key={reply.rpid} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 overflow-hidden rounded-full bg-slate-200">
                            {reply.member?.avatar ? (
                              <img src={reply.member.avatar} alt={reply.member?.uname || '用户'} className="h-full w-full object-cover" />
                            ) : null}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-slate-700">{reply.member?.uname || '用户'}</div>
                            <div className="text-[10px] text-slate-400">点赞 {reply.like || 0}</div>
                          </div>
                        </div>
                        <span className="text-[10px] uppercase text-slate-400">reply</span>
                      </div>
                      <div className="text-sm leading-6 text-slate-600">
                        {normalizeMessage(reply.content?.message) || '评论已加载'}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
                <X size={16} className="text-pink-500" />
                视频信息
              </div>

              <div className="space-y-3 text-sm text-slate-600">
                {pageInfo?.pic ? (
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                    <img src={pageInfo.pic} alt={pageInfo.title || '视频封面'} className="h-32 w-full object-cover" />
                  </div>
                ) : null}

                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">标题</div>
                  <div className="font-medium text-slate-700">{pageInfo?.title || '尚未选择视频'}</div>
                </div>

                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">UP 主</div>
                  <div className="font-medium text-slate-700">{pageInfo?.owner?.name || '暂无'}</div>
                </div>

                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">简介</div>
                  <div className="leading-6 text-slate-600">
                    {pageInfo?.desc ? normalizeMessage(pageInfo.desc) : '视频简介将在播放后显示。'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      <style>{`
        @keyframes bili-dm {
          0% { transform: translateX(0); opacity: 0; }
          8% { opacity: 1; }
          100% { transform: translateX(-140vw); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
