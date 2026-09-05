import { useState } from 'react';
import { ImageUp, Monitor, Palette, Shield, Trash2 } from 'lucide-react';
import { useOSStore } from '@/stores/useOSStore';
import type { AppProps } from '@/shell/types';

const WALLPAPERS = [
  { id: 'grid', label: '默认网格', url: '/wallpapers/grid.svg' },
  { id: 'arch', label: 'Arch Blue', url: '/wallpapers/arch.svg' },
  { id: 'dots', label: '暗夜点阵', url: '/wallpapers/dots.svg' },
  { id: 'aurora', label: '极光', url: '/wallpapers/aurora.svg' },
];

export default function Settings({ context }: AppProps) {
  const settings = useOSStore((s) => s.settings);
  const update = useOSStore((s) => s.updateSettings);
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const isPreset = WALLPAPERS.some((w) => w.url === settings.wallpaper);
  const isCustom = !isPreset;

  const handleFile = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setUploadMsg({ ok: false, text: '请选择图片文件' });
      return;
    }
    const MAX = 1.5 * 1024 * 1024; // 1.5MB，避免 localStorage 溢出
    if (file.size > MAX) {
      setUploadMsg({ ok: false, text: '图片超过 1.5MB，请压缩后再上传' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      try {
        update({ wallpaper: dataUrl });
        setUploadMsg({ ok: true, text: `已应用 ${file.name}` });
      } catch {
        setUploadMsg({ ok: false, text: '保存失败（存储已满）' });
      }
    };
    reader.onerror = () => setUploadMsg({ ok: false, text: '读取失败' });
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex h-full bg-arch-bg text-arch-text">
      <nav className="w-44 border-r border-arch-border bg-arch-panel/60 p-2 text-sm">
        {[
          { Icon: Monitor, label: '桌面' },
          { Icon: Palette, label: '外观' },
          { Icon: Shield, label: '系统' },
        ].map(({ Icon, label }, i) => (
          <div
            key={label}
            className={`flex items-center gap-2 rounded px-3 py-2 ${
              i === 0 ? 'bg-arch-accent/15 text-arch-accent' : 'hover:bg-white/5'
            }`}
          >
            <Icon size={14} /> {label}
          </div>
        ))}
      </nav>

      <div className="flex-1 space-y-6 overflow-auto p-5 text-sm">
        <section>
          <h3 className="mb-2 text-xs uppercase tracking-wider text-arch-muted">
            壁纸
          </h3>
          <div className="grid grid-cols-4 gap-2">
            {WALLPAPERS.map((w) => {
              const active = settings.wallpaper === w.url;
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => {
                    update({ wallpaper: w.url });
                    setUploadMsg(null);
                  }}
                  className={`overflow-hidden rounded-lg border-2 transition ${
                    active
                      ? 'border-arch-accent'
                      : 'border-transparent hover:border-arch-border'
                  }`}
                >
                  <div
                    className="h-16 w-full bg-cover bg-center"
                    style={{ backgroundImage: `url(${w.url})` }}
                  />
                  <div className="bg-black/40 py-1 text-[11px]">{w.label}</div>
                </button>
              );
            })}

            <label
              className={`flex h-16 cursor-pointer items-center justify-center gap-1 rounded-lg border-2 border-dashed transition ${
                isCustom
                  ? 'border-arch-accent bg-arch-accent/10 text-arch-accent'
                  : 'border-arch-border/60 text-arch-muted hover:border-arch-border hover:text-arch-text'
              }`}
              title="上传自己的图片（≤1.5MB，建议 JPG/PNG/WebP）"
            >
              <ImageUp size={18} />
              <span className="text-[11px]">上传</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          {isCustom && (
            <div className="mt-2 flex items-center gap-2 text-[11px]">
              <div
                className="h-8 w-14 rounded border border-arch-border bg-cover bg-center"
                style={{ backgroundImage: `url(${settings.wallpaper})` }}
              />
              <span className="flex-1 text-arch-muted">已应用自定义图片</span>
              <button
                onClick={() => {
                  update({ wallpaper: '/wallpapers/grid.svg' });
                  setUploadMsg({ ok: true, text: '已恢复默认壁纸' });
                }}
                className="flex items-center gap-1 rounded border border-arch-border px-2 py-1 text-arch-text hover:bg-white/10"
              >
                <Trash2 size={11} /> 清除
              </button>
            </div>
          )}

          {uploadMsg && (
            <div
              className={`mt-2 text-[11px] ${
                uploadMsg.ok ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {uploadMsg.text}
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-xs uppercase tracking-wider text-arch-muted">
            窗口
          </h3>
          <label className="mb-1 block text-xs">背景不透明度</label>
          <input
            type="range"
            min={0.5}
            max={1}
            step={0.02}
            value={settings.windowOpacity}
            onChange={(e) =>
              update({ windowOpacity: Number(e.target.value) })
            }
            className="w-full"
          />
          <div className="text-[11px] text-arch-muted">
            {(settings.windowOpacity * 100).toFixed(0)}%
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs uppercase tracking-wider text-arch-muted">
            安全
          </h3>
          <label className="mb-1 block text-xs">无操作自动锁屏（分钟）</label>
          <input
            type="number"
            min={0}
            max={60}
            value={settings.autoLockMinutes}
            onChange={(e) =>
              update({ autoLockMinutes: Math.max(0, Number(e.target.value)) })
            }
            className="w-24 rounded border border-arch-border bg-black/30 px-2 py-1 text-xs"
          />
          <div className="mt-1 text-[11px] text-arch-muted">
            设置为 0 表示不自动锁屏
          </div>
        </section>

        <section className="border-t border-arch-border pt-3 text-[11px] text-arch-muted">
          Arch Web OS v2 · 在浏览器里运行 Arch Linux
          <br />
          窗口 ID: {context.windowId}
        </section>
      </div>
    </div>
  );
}
