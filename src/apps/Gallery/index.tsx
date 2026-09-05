import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Image as ImageIcon, Plus, Trash2, X } from 'lucide-react';
import type { AppProps } from '@/shell/types';
import {
  countBlobs,
  deleteBlob,
  getBlob,
  listBlobs,
  putBlobs,
  type BlobRecord,
} from '@/services/mediaStore';
import { cn } from '@/lib/cn';

/* ---------------------------- 启动期预置示例图 ---------------------------- */

/**
 * 6 张几何风格 SVG 示例（不依赖网络资源）。
 * 写入 IndexedDB 的 key 加 ns 前缀，避免和用户上传冲突。
 */
const SEED_KEY = 'seed:welcome';
const USER_PREFIX = 'img:';

const SEED_SVGS = [
  {
    name: '几何蓝',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#1e3a8a"/><stop offset="100%" stop-color="#06b6d4"/>
      </linearGradient></defs>
      <rect width="480" height="320" fill="url(#g)"/>
      <circle cx="120" cy="100" r="60" fill="#fff" opacity="0.6"/>
      <polygon points="320,40 420,200 220,200" fill="#facc15" opacity="0.7"/>
      <rect x="60" y="200" width="200" height="80" rx="20" fill="#34d399" opacity="0.85"/>
    </svg>`,
  },
  {
    name: '日夜交替',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320">
      <defs><linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1e1b4b"/><stop offset="100%" stop-color="#f59e0b"/>
      </linearGradient></defs>
      <rect width="480" height="320" fill="url(#g2)"/>
      <circle cx="360" cy="180" r="50" fill="#fef3c7"/>
      <g fill="#fff" opacity="0.9">
        <circle cx="50" cy="40" r="1.6"/><circle cx="90" cy="80" r="1.2"/><circle cx="160" cy="50" r="1.8"/>
        <circle cx="240" cy="100" r="1.2"/><circle cx="300" cy="60" r="2"/><circle cx="380" cy="30" r="1.4"/>
      </g>
      <polygon points="0,260 480,260 480,320 0,320" fill="#0f172a" opacity="0.5"/>
    </svg>`,
  },
  {
    name: '极简网格',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320">
      <rect width="480" height="320" fill="#0f172a"/>
      <g stroke="#334155" stroke-width="1">
        ${Array.from({ length: 16 }, (_, i) => `<line x1="${i * 32}" y1="0" x2="${i * 32}" y2="320"/>`).join('')}
        ${Array.from({ length: 11 }, (_, i) => `<line x1="0" y1="${i * 32}" x2="480" y2="${i * 32}"/>`).join('')}
      </g>
      <circle cx="240" cy="160" r="60" fill="#22d3ee" opacity="0.9"/>
      <circle cx="240" cy="160" r="40" fill="#a78bfa" opacity="0.9"/>
      <circle cx="240" cy="160" r="20" fill="#fff"/>
    </svg>`,
  },
  {
    name: '雪花',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320">
      <rect width="480" height="320" fill="#0c4a6e"/>
      <g stroke="#bae6fd" stroke-width="2" stroke-linecap="round">
        ${Array.from({ length: 14 })
          .map(() => {
            const x = Math.random() * 480;
            const y = Math.random() * 320;
            const r = 6 + Math.random() * 8;
            return `<g transform="translate(${x} ${y})">
              <line x1="-${r}" y1="0" x2="${r}" y2="0"/>
              <line x1="0" y1="-${r}" x2="0" y2="${r}"/>
              <line x1="-${r * 0.7}" y1="-${r * 0.7}" x2="${r * 0.7}" y2="${r * 0.7}"/>
              <line x1="-${r * 0.7}" y1="${r * 0.7}" x2="${r * 0.7}" y2="-${r * 0.7}"/>
            </g>`;
          })
          .join('')}
      </g>
    </svg>`,
  },
  {
    name: '波浪',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320">
      <defs><linearGradient id="g3" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#8b5cf6"/><stop offset="100%" stop-color="#ec4899"/>
      </linearGradient></defs>
      <rect width="480" height="320" fill="url(#g3)"/>
      <path d="M0,160 Q60,80 120,160 T240,160 T360,160 T480,160 L480,320 L0,320 Z" fill="#fff" opacity="0.4"/>
      <path d="M0,220 Q60,140 120,220 T240,220 T360,220 T480,220 L480,320 L0,320 Z" fill="#fff" opacity="0.5"/>
    </svg>`,
  },
  {
    name: '樱花粉',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320">
      <defs><radialGradient id="g4" cx="0.5" cy="0.5" r="0.7">
        <stop offset="0%" stop-color="#fda4af"/><stop offset="100%" stop-color="#9f1239"/>
      </radialGradient></defs>
      <rect width="480" height="320" fill="url(#g4)"/>
      <g>
        ${Array.from({ length: 30 })
          .map(() => {
            const x = Math.random() * 480;
            const y = Math.random() * 320;
            const r = 4 + Math.random() * 6;
            return `<g transform="translate(${x} ${y}) rotate(${Math.random() * 360})">
              <path d="M0,-${r} C${r * 0.4},-${r * 0.7} ${r},-${r * 0.4} ${r},0 C${r},${r * 0.4} ${r * 0.4},${r * 0.7} 0,${r} C-${r * 0.4},${r * 0.7} -${r},${r * 0.4} -${r},0 C-${r},-${r * 0.4} -${r * 0.4},-${r * 0.7} 0,-${r} Z" fill="#fff" opacity="0.7"/>
              <circle r="1.4" fill="#fbcfe8"/>
            </g>`;
          })
          .join('')}
      </g>
    </svg>`,
  },
];

async function ensureSeed(): Promise<void> {
  if ((await countBlobs()) > 0) return;
  const records: BlobRecord[] = SEED_SVGS.map((it, i) => ({
    key: `${SEED_KEY}-${i}`,
    name: it.name,
    blob: new Blob([it.svg], { type: 'image/svg+xml' }),
    addedAt: Date.now() - (SEED_SVGS.length - i) * 10_000, // 倒序展示
  }));
  await putBlobs(records);
}

/* -------------------------------- 组件 -------------------------------- */

interface Photo {
  key: string;
  name: string;
  url: string; // 由 blob 生成的 ObjectURL，每次刷新重建
  addedAt: number;
}

export default function Gallery(_: AppProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  // 加载期：预置 + 列出 + 生成 ObjectURL
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureSeed();
        const records = await listBlobs();
        records.sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0));
        if (cancelled) return;
        setPhotos(
          records.map((r) => ({
            key: r.key,
            name: r.name ?? '未命名',
            url: URL.createObjectURL(r.blob),
            addedAt: r.addedAt ?? 0,
          })),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 卸载：revoke 所有 URL
  useEffect(() => {
    return () => {
      photos.forEach((p) => URL.revokeObjectURL(p.url));
    };
    // 仅卸载时清理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = async () => {
    const records = await listBlobs();
    records.sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0));
    // 释放旧 URL
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    setPhotos(
      records.map((r) => ({
        key: r.key,
        name: r.name ?? '未命名',
        url: URL.createObjectURL(r.blob),
        addedAt: r.addedAt ?? 0,
      })),
    );
  };

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const records: BlobRecord[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f.type.startsWith('image/')) continue;
      records.push({
        key: `${USER_PREFIX}${crypto.randomUUID()}`,
        name: f.name,
        blob: f,
        addedAt: Date.now() + i,
      });
    }
    if (records.length === 0) return;
    await putBlobs(records);
    await refresh();
  };

  const removePhoto = async (key: string) => {
    const target = photos.find((p) => p.key === key);
    if (target?.url) URL.revokeObjectURL(target.url);
    await deleteBlob(key);
    setPhotos((prev) => prev.filter((p) => p.key !== key));
    if (activeIdx !== null) {
      const next = photos.findIndex((p) => p.key === key);
      if (next === activeIdx) {
        setActiveIdx(null);
      } else if (next < activeIdx) {
        setActiveIdx((i) => (i === null ? null : i - 1));
      }
    }
  };

  const openLightbox = (idx: number) => setActiveIdx(idx);
  const closeLightbox = () => setActiveIdx(null);
  const next = () =>
    setActiveIdx((i) => (i === null ? null : (i + 1) % photos.length));
  const prev = () =>
    setActiveIdx((i) => (i === null ? null : (i - 1 + photos.length) % photos.length));

  useEffect(() => {
    if (activeIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, photos.length]);

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-100">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          onPick(e.target.files);
          e.target.value = '';
        }}
      />

      {/* 顶栏 */}
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm">
          <ImageIcon size={16} className="text-emerald-400" />
          <span className="font-medium">图库</span>
          <span className="text-xs text-zinc-500">· {photos.length} 张</span>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium hover:bg-emerald-500"
        >
          <Plus size={14} />
          添加图片
        </button>
      </header>

      {/* 主体 */}
      <main className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-500">
            加载中…
          </div>
        ) : photos.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-zinc-500">
            <ImageIcon size={42} className="mb-3 opacity-30" />
            <p className="text-sm">还没有图片</p>
            <p className="mt-1 text-xs text-zinc-600">点击上方"添加图片"开始</p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2.5">
            {photos.map((p, i) => (
              <div
                key={p.key}
                className={cn(
                  'group relative overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-white/5',
                  'cursor-zoom-in transition hover:ring-emerald-500/60',
                  activeIdx === i && 'ring-2 ring-emerald-500',
                )}
                onClick={() => openLightbox(i)}
              >
                <img
                  src={p.url}
                  alt={p.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removePhoto(p.key);
                  }}
                  className="absolute right-1 top-1 rounded bg-black/60 p-1 text-zinc-300 opacity-0 hover:text-red-300 group-hover:opacity-100"
                  title="删除"
                >
                  <Trash2 size={12} />
                </button>
                <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-2 py-1 text-[10px] text-zinc-200">
                  {p.name}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* 灯箱 */}
      {activeIdx !== null && photos[activeIdx] && (
        <Lightbox
          photo={photos[activeIdx]}
          onClose={closeLightbox}
          onPrev={prev}
          onNext={next}
        />
      )}
    </div>
  );
}

function Lightbox({
  photo,
  onClose,
  onPrev,
  onNext,
}: {
  photo: Photo;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
      onClick={onClose}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        title="关闭（Esc）"
      >
        <X size={20} />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onPrev();
        }}
        className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
        title="上一张（←）"
      >
        <ChevronLeft size={24} />
      </button>
      <img
        src={photo.url}
        alt={photo.name}
        className="max-h-[88vh] max-w-[88vw] rounded-lg object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        onClick={(e) => {
          e.stopPropagation();
          onNext();
        }}
        className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
        title="下一张（→）"
      >
        <ChevronRight size={24} />
      </button>
      <div className="absolute inset-x-0 bottom-4 text-center text-xs text-zinc-300">
        {photo.name}
      </div>
    </div>
  );
}
