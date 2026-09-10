import { useEffect, useRef, useState } from 'react';
import {
  Sun,
  CloudSun,
  Cloud,
  CloudFog,
  CloudRain,
  CloudSnow,
  CloudLightning,
  Search,
  Wind,
  Droplets,
  Thermometer,
  RotateCcw,
  AlertTriangle,
  MapPin,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';

interface GeoResult {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
}

interface GeoResponse {
  results?: GeoResult[];
}

interface Current {
  temperature_2m: number;
  relative_humidity_2m: number;
  apparent_temperature: number;
  weather_code: number;
  wind_speed_10m: number;
  precipitation: number;
}

interface Daily {
  time: string[];
  weather_code: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_sum: number[];
}

interface ForecastResponse {
  current: Current;
  daily: Daily;
}

interface SavedCity {
  name: string;
  latitude: number;
  longitude: number;
}

const STORAGE_KEY = 'arch-web-os:weather-city';
const TIMEOUT_MS = 8000;

interface WmoInfo {
  desc: string;
  Icon: LucideIcon;
}

function wmo(code: number): WmoInfo {
  if (code === 0) return { desc: '晴', Icon: Sun };
  if (code === 1) return { desc: '晴间多云', Icon: CloudSun };
  if (code === 2) return { desc: '多云', Icon: CloudSun };
  if (code === 3) return { desc: '阴', Icon: Cloud };
  if (code === 45 || code === 48) return { desc: '雾', Icon: CloudFog };
  if (code >= 51 && code <= 57) return { desc: '毛毛雨', Icon: CloudRain };
  if (code >= 61 && code <= 67) return { desc: '雨', Icon: CloudRain };
  if (code >= 71 && code <= 77) return { desc: '雪', Icon: CloudSnow };
  if (code >= 80 && code <= 82) return { desc: '阵雨', Icon: CloudRain };
  if (code >= 85 && code <= 86) return { desc: '阵雪', Icon: CloudSnow };
  if (code >= 95) return { desc: '雷暴', Icon: CloudLightning };
  return { desc: '未知', Icon: Cloud };
}

function loadSaved(): SavedCity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as SavedCity;
    if (typeof v.latitude === 'number' && typeof v.longitude === 'number') return v;
    return null;
  } catch {
    return null;
  }
}

function saveCity(c: SavedCity) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* 隐私模式忽略 */
  }
}

export default function Weather({ context }: AppProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [cityName, setCityName] = useState('');
  const [current, setCurrent] = useState<Current | null>(null);
  const [daily, setDaily] = useState<Daily | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastCoordsRef = useRef<{ lat: number; lon: number; name: string } | null>(null);

  useEffect(() => {
    context.setTitle('天气');
  }, [context]);

  useEffect(() => {
    const saved = loadSaved();
    if (saved) {
      setCityName(saved.name);
      void fetchForecast(saved.latitude, saved.longitude, saved.name, false);
    }
    return () => {
      abortRef.current?.abort();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
    // 仅挂载时执行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function searchCity(q: string) {
    const name = q.trim();
    if (!name) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => controller.abort(), TIMEOUT_MS);

    setLoading(true);
    setError('');
    setResults([]);
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        name,
      )}&count=5&language=zh`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`地理编码请求失败（${res.status}）`);
      const data = (await res.json()) as GeoResponse;
      const list = data.results ?? [];
      if (list.length === 0) {
        setError('没有找到匹配的城市，请检查拼写');
        setLoading(false);
        return;
      }
      setResults(list);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('请求超时（8 秒），请检查网络后重试');
      } else {
        setError('网络错误：' + (err instanceof Error ? err.message : String(err)));
      }
    } finally {
      setLoading(false);
    }
  }

  async function fetchForecast(lat: number, lon: number, name: string, persist = true) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => controller.abort(), TIMEOUT_MS);

    setLoading(true);
    setError('');
    setResults([]);
    lastCoordsRef.current = { lat, lon, name };
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum` +
        `&timezone=auto&forecast_days=7`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`预报请求失败（${res.status}）`);
      const data = (await res.json()) as ForecastResponse;
      setCurrent(data.current);
      setDaily(data.daily);
      setCityName(name);
      if (persist) saveCity({ name, latitude: lat, longitude: lon });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('请求超时（8 秒），请检查网络后重试');
      } else {
        setError('网络错误：' + (err instanceof Error ? err.message : String(err)));
      }
    } finally {
      setLoading(false);
    }
  }

  const maxAll = daily ? Math.max(...daily.temperature_2m_max) : 0;
  const minAll = daily ? Math.min(...daily.temperature_2m_min) : 0;
  const range = maxAll - minAll;

  return (
    <div className="flex h-full flex-col bg-arch-bg text-arch-text">
      {/* 搜索栏 */}
      <div className="flex items-center gap-2 border-b border-arch-border bg-arch-panel px-2 py-2 text-[12px]">
        <div className="flex flex-1 items-center gap-1 rounded border border-arch-border bg-arch-bg px-2">
          <Search size={14} className="text-arch-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void searchCity(query);
            }}
            placeholder="输入城市名，如：北京 / 上海 / Tokyo"
            className="w-full bg-transparent py-1 text-arch-text outline-none placeholder:text-arch-muted"
          />
        </div>
        <button
          type="button"
          onClick={() => void searchCity(query)}
          className="rounded border border-arch-accent bg-arch-accent px-3 py-1.5 text-white"
        >
          搜索
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {error && (
          <div className="mb-3 flex items-start gap-2 rounded border border-arch-red/40 bg-arch-red/10 p-3 text-[12px] text-arch-red">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <p>{error}</p>
              <button
                type="button"
                onClick={() => {
                  const last = lastCoordsRef.current;
                  if (last) void fetchForecast(last.lat, last.lon, last.name, false);
                }}
                className="mt-1 flex items-center gap-1 text-arch-accent hover:underline"
              >
                <RotateCcw size={12} /> 重试
              </button>
            </div>
          </div>
        )}

        {/* 城市候选 */}
        {results.length > 0 && (
          <div className="mb-3 overflow-hidden rounded border border-arch-border">
            {results.map((r) => (
              <button
                key={`${r.latitude}-${r.longitude}`}
                type="button"
                onClick={() => void fetchForecast(r.latitude, r.longitude, r.name)}
                className="flex w-full items-center gap-2 border-b border-arch-border px-3 py-2 text-left text-[12px] last:border-b-0 hover:bg-arch-panel"
              >
                <MapPin size={14} className="text-arch-accent" />
                <span className="text-arch-text">{r.name}</span>
                <span className="text-arch-muted">
                  {[r.admin1, r.country].filter(Boolean).join(' · ')}
                </span>
              </button>
            ))}
          </div>
        )}

        {loading && (
          <p className="py-6 text-center text-[12px] text-arch-muted">加载中…</p>
        )}

        {!loading && !error && !current && results.length === 0 && (
          <p className="py-10 text-center text-[12px] text-arch-muted">
            搜索一个城市查看实时天气与 7 天预报
          </p>
        )}

        {/* 当前天气大卡 */}
        {current && (
          <div className="mb-3 rounded-lg border border-arch-border bg-arch-panel p-4">
            <div className="mb-2 flex items-center gap-2 text-[12px] text-arch-muted">
              <MapPin size={14} className="text-arch-accent" />
              {cityName}
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-4xl font-semibold tabular-nums text-arch-text">
                  {Math.round(current.temperature_2m)}°
                </div>
                <div className="text-[12px] text-arch-muted">
                  体感 {Math.round(current.apparent_temperature)}°
                </div>
              </div>
              <div className="flex flex-col items-center text-arch-accent">
                {(() => {
                  const { Icon, desc } = wmo(current.weather_code);
                  return (
                    <>
                      <Icon size={48} />
                      <span className="mt-1 text-[12px] text-arch-text">{desc}</span>
                    </>
                  );
                })()}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
              <Metric icon={Droplets} label="湿度" value={`${current.relative_humidity_2m}%`} />
              <Metric icon={Wind} label="风速" value={`${current.wind_speed_10m} km/h`} />
              <Metric icon={Thermometer} label="降水" value={`${current.precipitation} mm`} />
            </div>
          </div>
        )}

        {/* 7 天预报 + 趋势 */}
        {daily && (
          <div className="rounded-lg border border-arch-border bg-arch-panel p-3">
            <div className="mb-2 text-[12px] text-arch-muted">未来 7 天</div>
            <div className="grid grid-cols-7 gap-1">
              {daily.time.map((t, i) => {
                const code = daily.weather_code[i];
                const mx = daily.temperature_2m_max[i];
                const mn = daily.temperature_2m_min[i];
                const sum = daily.precipitation_sum[i];
                if (code === undefined || mx === undefined || mn === undefined) return null;
                const { Icon, desc } = wmo(code);
                const dayLabel = new Date(t).toLocaleDateString('zh-CN', { weekday: 'short' });
                const maxH = range > 0 ? ((mx - minAll) / range) * 64 + 4 : 8;
                const minH = range > 0 ? ((mn - minAll) / range) * 64 + 4 : 4;
                return (
                  <div key={t} className="flex flex-col items-center gap-1 text-center">
                    <span className="text-[10px] text-arch-muted">{dayLabel}</span>
                    <Icon size={18} className="text-arch-accent" />
                    <div className="flex h-[72px] items-end gap-0.5">
                      <div
                        className="w-1.5 rounded-sm bg-arch-red/70"
                        style={{ height: `${maxH}px` }}
                        title={`最高 ${Math.round(mx)}°`}
                      />
                      <div
                        className="w-1.5 rounded-sm bg-arch-accent/60"
                        style={{ height: `${minH}px` }}
                        title={`最低 ${Math.round(mn)}°`}
                      />
                    </div>
                    <span className="text-[11px] tabular-nums text-arch-text">{Math.round(mx)}°</span>
                    <span className="text-[10px] tabular-nums text-arch-muted">{Math.round(mn)}°</span>
                    <span className="text-[9px] text-arch-muted" title={desc}>
                      {sum > 0 ? `${sum}mm` : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] text-arch-muted">
              柱状为最高温（红）/ 最低温（蓝）趋势，数字为当日最高与最低。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-0.5 rounded bg-arch-bg py-2')}>
      <Icon size={15} className="text-arch-accent" />
      <span className="text-arch-muted">{label}</span>
      <span className="tabular-nums text-arch-text">{value}</span>
    </div>
  );
}
