import { useEffect, useRef, useState } from 'react';
import {
  Camera as CameraIcon,
  Video,
  VideoOff,
  CameraOff,
  SwitchCamera,
  Download,
  Copy,
  Trash2,
  RotateCcw,
  AlertTriangle,
} from 'lucide-react';
import type { AppProps } from '@/shell/types';
import { cn } from '@/lib/cn';
import { notify } from '@/stores/useNotifyStore';

type Status = 'idle' | 'loading' | 'ready' | 'denied' | 'error';

interface DeviceOption {
  deviceId: string;
  label: string;
}

interface Photo {
  id: string;
  url: string;
  dataUrl: string;
}

const MAX_PHOTOS = 30;

export default function Camera({ context }: AppProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const photosRef = useRef<Photo[]>([]);
  const recordedRef = useRef<string | null>(null);

  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [videoDevices, setVideoDevices] = useState<DeviceOption[]>([]);
  const [audioDevices, setAudioDevices] = useState<DeviceOption[]>([]);
  const [videoDeviceId, setVideoDeviceId] = useState('');
  const [audioDeviceId, setAudioDeviceId] = useState('');
  const [recording, setRecording] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);

  function stopStream() {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function stopRecorder() {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop();
      } catch {
        /* 已停止 */
      }
    }
    recorderRef.current = null;
  }

  async function refreshDevices() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const vids: DeviceOption[] = [];
      const auds: DeviceOption[] = [];
      list.forEach((d, i) => {
        if (d.kind === 'videoinput') {
          vids.push({ deviceId: d.deviceId, label: d.label || `摄像头 ${i + 1}` });
        } else if (d.kind === 'audioinput') {
          auds.push({ deviceId: d.deviceId, label: d.label || `麦克风 ${i + 1}` });
        }
      });
      setVideoDevices(vids);
      setAudioDevices(auds);
      if (!videoDeviceId && vids.length > 0) setVideoDeviceId(vids[0]!.deviceId);
      if (!audioDeviceId && auds.length > 0) setAudioDeviceId(auds[0]!.deviceId);
    } catch {
      /* 设备枚举失败不阻塞预览 */
    }
  }

  async function startCamera(deviceId?: string) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('error');
      setErrorMsg('当前环境不支持摄像头（需要 HTTPS 或 localhost）');
      return;
    }
    setStatus('loading');
    setErrorMsg('');
    stopStream();
    const targetVid = deviceId || videoDeviceId;
    const targetAud = audioDeviceId;
    const constraints: MediaStreamConstraints = {
      video: targetVid
        ? { deviceId: { exact: targetVid }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: targetAud ? { deviceId: { exact: targetAud } } : false,
    };
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      await refreshDevices();
      setStatus('ready');
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setStatus('denied');
        setErrorMsg('摄像头权限被拒绝。请在浏览器地址栏的权限设置中允许访问，然后点击重试。');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setStatus('error');
        setErrorMsg('未找到可用的摄像头设备，或所选设备不可用。');
      } else {
        setStatus('error');
        setErrorMsg('无法打开摄像头：' + (err instanceof Error ? err.message : String(err)));
      }
    }
  }

  function takePhoto() {
    const video = videoRef.current;
    if (!video || status !== 'ready') return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    const canvas = document.createElement('canvas');
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, vw, vh);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const dataUrl = canvas.toDataURL('image/png');
      const photo: Photo = { id: `p-${Date.now()}`, url, dataUrl };
      const next = [photo, ...photosRef.current].slice(0, MAX_PHOTOS);
      photosRef.current = next;
      setPhotos(next);
      notify('已拍照', '可在下方胶卷中查看', 'success');
    }, 'image/png');
  }

  async function copyPhoto(p: Photo) {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      notify('不支持', '当前浏览器无法写入图片剪贴板', 'warn');
      return;
    }
    try {
      const blob = await (await fetch(p.url)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      notify('已复制', '照片已复制到剪贴板', 'success');
    } catch {
      notify('复制失败', '浏览器拒绝了剪贴板写入', 'error');
    }
  }

  function downloadPhoto(p: Photo) {
    const a = document.createElement('a');
    a.href = p.url;
    a.download = `photo-${p.id}.png`;
    a.click();
  }

  function deletePhoto(id: string) {
    const target = photosRef.current.find((p) => p.id === id);
    if (target) URL.revokeObjectURL(target.url);
    const next = photosRef.current.filter((p) => p.id !== id);
    photosRef.current = next;
    setPhotos(next);
  }

  function startRec() {
    const stream = streamRef.current;
    if (!stream) return;
    let mime = 'video/webm';
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm')) {
      mime = 'video/webm';
    } else if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4')) {
      mime = 'video/mp4';
    }
    const rec = new MediaRecorder(stream, { mimeType: mime });
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mime });
      const url = URL.createObjectURL(blob);
      if (recordedRef.current) URL.revokeObjectURL(recordedRef.current);
      recordedRef.current = url;
      setRecordedUrl(url);
      notify('录制完成', '可在下方播放与下载', 'success');
    };
    rec.start();
    recorderRef.current = rec;
    setRecording(true);
  }

  function stopRec() {
    stopRecorder();
    setRecording(false);
  }

  function downloadRecorded() {
    if (!recordedUrl) return;
    const a = document.createElement('a');
    a.href = recordedUrl;
    a.download = `recording-${Date.now()}.webm`;
    a.click();
  }

  useEffect(() => {
    context.setTitle('相机');
    void startCamera();
    return () => {
      stopRecorder();
      stopStream();
      photosRef.current.forEach((p) => URL.revokeObjectURL(p.url));
      if (recordedRef.current) URL.revokeObjectURL(recordedRef.current);
    };
    // 仅挂载时启动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col bg-arch-bg text-arch-text">
      {/* 设备选择栏 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-arch-border bg-arch-panel px-2 py-1.5 text-[11px]">
        <label className="flex items-center gap-1 text-arch-muted">
          摄像头
          <select
            value={videoDeviceId}
            onChange={(e) => {
              setVideoDeviceId(e.target.value);
              void startCamera(e.target.value);
            }}
            className="rounded border border-arch-border bg-arch-bg px-1 py-0.5 text-arch-text"
          >
            {videoDevices.length === 0 && <option value="">默认</option>}
            {videoDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-arch-muted">
          麦克风
          <select
            value={audioDeviceId}
            onChange={(e) => setAudioDeviceId(e.target.value)}
            className="rounded border border-arch-border bg-arch-bg px-1 py-0.5 text-arch-text"
          >
            <option value="">关闭</option>
            {audioDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          title="切换前后摄像头"
          onClick={() => {
            const others = videoDevices.filter((d) => d.deviceId !== videoDeviceId);
            const next = others[0]?.deviceId ?? videoDeviceId;
            setVideoDeviceId(next);
            void startCamera(next);
          }}
          className="flex h-7 items-center gap-1 rounded border border-arch-border px-2 text-arch-muted hover:text-arch-text"
        >
          <SwitchCamera size={14} /> 切换
        </button>
      </div>

      {/* 预览区 */}
      <div className="relative flex-1 overflow-hidden bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={cn('h-full w-full object-contain', status === 'ready' ? 'block' : 'hidden')}
        />

        {status !== 'ready' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            {status === 'loading' && (
              <p className="text-arch-muted">正在请求摄像头权限并打开预览…</p>
            )}
            {(status === 'denied' || status === 'error') && (
              <>
                <AlertTriangle size={36} className="text-arch-red" />
                <p className="max-w-xs text-sm text-arch-text">{errorMsg}</p>
                <button
                  type="button"
                  onClick={() => void startCamera()}
                  className="flex items-center gap-1 rounded border border-arch-accent bg-arch-accent px-3 py-1.5 text-white"
                >
                  <RotateCcw size={14} /> 重试
                </button>
              </>
            )}
            {status === 'idle' && <p className="text-arch-muted">正在初始化…</p>}
          </div>
        )}

        {recording && (
          <div className="absolute left-2 top-2 flex items-center gap-1 rounded bg-black/60 px-2 py-1 text-[11px] text-red-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> 录制中
          </div>
        )}
      </div>

      {/* 控制栏 */}
      <div className="flex items-center gap-2 border-t border-arch-border bg-arch-panel px-2 py-2">
        <button
          type="button"
          onClick={takePhoto}
          disabled={status !== 'ready'}
          title="拍照"
          className={cn(
            'flex h-9 items-center gap-1 rounded border px-3 text-[12px]',
            status === 'ready'
              ? 'border-arch-accent bg-arch-accent text-white'
              : 'cursor-not-allowed border-arch-border text-arch-muted opacity-40',
          )}
        >
          <CameraIcon size={16} /> 拍照
        </button>
        {!recording ? (
          <button
            type="button"
            onClick={startRec}
            disabled={status !== 'ready'}
            title="开始录制"
            className={cn(
              'flex h-9 items-center gap-1 rounded border px-3 text-[12px]',
              status === 'ready'
                ? 'border-arch-border text-arch-muted hover:text-arch-text'
                : 'cursor-not-allowed text-arch-muted opacity-40',
            )}
          >
            <Video size={16} /> 录制
          </button>
        ) : (
          <button
            type="button"
            onClick={stopRec}
            title="停止录制"
            className="flex h-9 items-center gap-1 rounded border border-arch-red px-3 text-[12px] text-arch-red"
          >
            <VideoOff size={16} /> 停止
          </button>
        )}
        {status !== 'ready' && status !== 'loading' && (
          <button
            type="button"
            onClick={() => void startCamera()}
            className="flex h-9 items-center gap-1 rounded border border-arch-border px-3 text-[12px] text-arch-muted hover:text-arch-text"
          >
            <CameraOff size={16} /> 重新打开
          </button>
        )}
      </div>

      {/* 胶卷 + 录像回放 */}
      <div className="max-h-44 overflow-y-auto border-t border-arch-border bg-arch-panel p-2">
        {recordedUrl && (
          <div className="mb-3">
            <div className="mb-1 flex items-center justify-between text-[11px] text-arch-muted">
              <span>录像回放</span>
              <button
                type="button"
                onClick={downloadRecorded}
                className="flex items-center gap-1 text-arch-accent hover:underline"
              >
                <Download size={12} /> 下载
              </button>
            </div>
            <video src={recordedUrl} controls className="max-h-32 rounded border border-arch-border" />
          </div>
        )}

        <div className="mb-1 text-[11px] text-arch-muted">胶卷（{photos.length}）</div>
        {photos.length === 0 ? (
          <p className="py-3 text-center text-[11px] text-arch-muted">还没有照片，点上方「拍照」试试</p>
        ) : (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {photos.map((p) => (
              <div key={p.id} className="group relative">
                <img
                  src={p.url}
                  alt="照片"
                  className="aspect-square w-full rounded border border-arch-border object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/60 opacity-0 transition group-hover:opacity-100">
                  <button
                    type="button"
                    title="复制"
                    onClick={() => void copyPhoto(p)}
                    className="rounded bg-arch-panel p-1 text-arch-text hover:text-arch-accent"
                  >
                    <Copy size={13} />
                  </button>
                  <button
                    type="button"
                    title="下载"
                    onClick={() => downloadPhoto(p)}
                    className="rounded bg-arch-panel p-1 text-arch-text hover:text-arch-accent"
                  >
                    <Download size={13} />
                  </button>
                  <button
                    type="button"
                    title="删除"
                    onClick={() => deletePhoto(p.id)}
                    className="rounded bg-arch-panel p-1 text-arch-text hover:text-arch-red"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
