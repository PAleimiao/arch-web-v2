import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  KeyRound,
  MessageSquareText,
  Plus,
  RefreshCcw,
  SendHorizontal,
  Settings2,
  Sparkles,
  Trash2,
  Wand2,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import type { AppProps } from '@/shell/types';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type Agent = {
  id: string;
  name: string;
  prompt: string;
  model: string;
  accent: string;
  description?: string;
};

type ApiConfig = {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

type ProviderPreset = {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  hint: string;
};

const STORAGE_KEY = 'arch-ai-assistant-config-v1';

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI 兼容',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    hint: '适合 OpenAI / Azure OpenAI / 兼容接口',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    hint: '适合 DeepSeek 官方接口',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://localhost:11434',
    model: 'llama3.1',
    hint: '适合本地部署模型',
  },
  {
    id: 'custom',
    label: '自定义',
    baseUrl: '',
    model: '',
    hint: '任何兼容 OpenAI 接口的服务',
  },
];

const QUICK_PROMPTS = [
  '帮我总结这段内容的重点，并给出 3 个改进建议。',
  '把这个需求拆成步骤，列出可执行方案。',
  '帮我写一份简洁的周报内容。',
  '用中文解释这个问题，并给出示例。',
];

const DEFAULT_CONFIG: ApiConfig = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
};

const DEFAULT_AGENT: Agent = {
  id: 'default-agent',
  name: '默认助手',
  prompt:
    '你是一个简洁、可靠的个人 AI 助手。先理解用户意图，再给出结构清晰、直接可执行的回答。',
  model: 'gpt-4o-mini',
  accent: '#61afef',
  description: '默认的通用助手，适合日常提问、总结与整理。',
};

const AGENT_ACCENTS = ['#61afef', '#4ec9b0', '#c678dd', '#d19a66', '#e06c75'];

function loadStoredData() {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as {
      config?: Partial<ApiConfig>;
      agents?: Agent[];
      activeAgentId?: string;
    };

    const agents = Array.isArray(parsed.agents) && parsed.agents.length > 0
      ? parsed.agents
      : [DEFAULT_AGENT];

    const activeAgentId = parsed.activeAgentId ?? agents[0]?.id ?? DEFAULT_AGENT.id;

    return {
      config: { ...DEFAULT_CONFIG, ...parsed.config },
      agents,
      activeAgentId,
    };
  } catch {
    return null;
  }
}

function buildEndpoint(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return 'https://api.openai.com/v1/chat/completions';

  if (/\/api\/chat$/i.test(trimmed) || /\/chat\/completions$/i.test(trimmed)) {
    return trimmed;
  }

  return `${trimmed}/chat/completions`;
}

function createWelcomeMessage() {
  return {
    id: 'welcome',
    role: 'assistant' as const,
    content:
      '欢迎使用 AI 助手。先在左侧配置自己的 API，再选择适合的 Agent，即可开始会话。',
  };
}

export default function DeepAI({ context }: AppProps) {
  const [config, setConfig] = useState<ApiConfig>(DEFAULT_CONFIG);
  const [agents, setAgents] = useState<Agent[]>([DEFAULT_AGENT]);
  const [activeAgentId, setActiveAgentId] = useState<string>(DEFAULT_AGENT.id);
  const [messages, setMessages] = useState<ChatMessage[]>([createWelcomeMessage()]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(true);
  const [showAgentForm, setShowAgentForm] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [newAgent, setNewAgent] = useState({
    name: '',
    prompt: '',
    description: '',
    model: '',
  });

  useEffect(() => {
    context.setTitle('AI 助手');
  }, [context]);

  useEffect(() => {
    const stored = loadStoredData();
    if (stored) {
      setConfig(stored.config);
      setAgents(stored.agents);
      setActiveAgentId(stored.activeAgentId);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;

    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          config,
          agents,
          activeAgentId,
        }),
      );
    } catch {
      // ignore storage write failure
    }
  }, [hydrated, config, agents, activeAgentId]);

  const activeAgent = useMemo(
    () => agents.find((agent) => agent.id === activeAgentId) ?? agents[0] ?? DEFAULT_AGENT,
    [agents, activeAgentId],
  );

  const canSend = !!config.apiKey.trim() && !!config.baseUrl.trim() && !isLoading;
  const todayLabel = new Date().toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
  });

  function applyPreset(preset: ProviderPreset) {
    setConfig((prev) => ({
      ...prev,
      provider: preset.id,
      baseUrl: preset.baseUrl,
      model: preset.model,
    }));
    setError(null);
  }

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || !canSend) {
      if (!config.apiKey.trim()) {
        setError('请先导入自己的 API Key。');
      } else if (!config.baseUrl.trim()) {
        setError('请先填写 API 地址。');
      }
      return;
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };

    const conversation = [...messages, userMessage];
    setMessages(conversation);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      const endpoint = buildEndpoint(config.baseUrl);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: activeAgent.model || config.model,
          messages: [
            {
              role: 'system',
              content:
                activeAgent.prompt ||
                '你是一个简洁、可靠的个人 AI 助手。保持回答清晰、直接、围绕用户需求。',
            },
            ...conversation.map((item) => ({
              role: item.role,
              content: item.content,
            })),
          ],
        }),
      });

      const raw = await response.text();
      let data: any;

      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        throw new Error(raw || '返回内容不是 JSON。');
      }

      if (!response.ok) {
        throw new Error(data?.error?.message || '请求失败。');
      }

      const reply =
        data?.choices?.[0]?.message?.content?.trim() || '（模型返回空内容）';

      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: reply,
        },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : '消息发送失败。';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  function handleAddAgent() {
    const name = newAgent.name.trim();
    const prompt = newAgent.prompt.trim();

    if (!name) {
      setError('Agent 名称不能为空。');
      return;
    }

    const nextAgent: Agent = {
      id: `agent-${Date.now()}`,
      name,
      prompt: prompt || '你是一个简洁、可靠的个人 AI 助手。',
      model: newAgent.model.trim() || config.model,
      accent: AGENT_ACCENTS[(agents.length + 1) % AGENT_ACCENTS.length],
      description:
        newAgent.description.trim() || '自定义 Agent，用于指定特定场景。',
    };

    setAgents((prev) => [...prev, nextAgent]);
    setActiveAgentId(nextAgent.id);
    setShowAgentForm(false);
    setNewAgent({ name: '', prompt: '', description: '', model: '' });
    setError(null);
  }

  function handleRemoveAgent(id: string) {
    if (agents.length === 1) {
      setError('至少保留一个默认 Agent。');
      return;
    }

    const nextAgents = agents.filter((agent) => agent.id !== id);
    setAgents(nextAgents);

    if (activeAgentId === id) {
      setActiveAgentId(nextAgents[0]?.id ?? DEFAULT_AGENT.id);
    }
  }

  function resetConversation() {
    setMessages([createWelcomeMessage()]);
    setError(null);
  }

  return (
    <div className="flex h-full overflow-hidden bg-arch-bg text-arch-text">
      <aside className="flex w-[320px] shrink-0 flex-col border-r border-arch-border bg-arch-panel/70 p-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-arch-accent/15 text-arch-accent">
              <Bot size={18} />
            </div>
            <div>
              <div className="text-sm font-medium">AI 助手</div>
              <div className="text-[10px] text-arch-muted">自定义 API • Agent</div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowConfig((prev) => !prev)}
            className="rounded-lg border border-arch-border bg-black/20 p-2 text-arch-muted transition hover:bg-white/5"
            aria-label="切换配置"
          >
            <Settings2 size={14} />
          </button>
        </div>

        {showConfig && (
          <div className="mb-4 space-y-3 rounded-xl border border-arch-border bg-black/20 p-3">
            <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.12em] text-arch-muted uppercase">
              <KeyRound size={12} />
              API 配置
            </div>

            <div className="grid grid-cols-2 gap-2">
              {PROVIDER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className={cn(
                    'rounded-lg border px-2 py-1.5 text-left text-[10px] transition',
                    config.provider === preset.id
                      ? 'border-arch-accent bg-arch-accent/10 text-arch-text'
                      : 'border-arch-border bg-black/10 text-arch-muted hover:bg-white/5',
                  )}
                >
                  <div className="font-medium">{preset.label}</div>
                  <div className="mt-0.5 text-[9px] opacity-70">{preset.hint}</div>
                </button>
              ))}
            </div>

            <label className="block text-[11px] text-arch-muted">
              API 地址
              <input
                value={config.baseUrl}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, baseUrl: e.target.value }))
                }
                placeholder="https://api.openai.com/v1"
                className="mt-1 w-full rounded-lg border border-arch-border bg-black/25 px-2.5 py-1.5 text-xs text-arch-text outline-none transition focus:border-arch-accent"
              />
            </label>

            <label className="block text-[11px] text-arch-muted">
              API Key
              <input
                type="password"
                value={config.apiKey}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, apiKey: e.target.value }))
                }
                placeholder="输入你的 API Key"
                className="mt-1 w-full rounded-lg border border-arch-border bg-black/25 px-2.5 py-1.5 text-xs text-arch-text outline-none transition focus:border-arch-accent"
              />
            </label>

            <label className="block text-[11px] text-arch-muted">
              默认模型
              <input
                value={config.model}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, model: e.target.value }))
                }
                placeholder="gpt-4o-mini"
                className="mt-1 w-full rounded-lg border border-arch-border bg-black/25 px-2.5 py-1.5 text-xs text-arch-text outline-none transition focus:border-arch-accent"
              />
            </label>
          </div>
        )}

        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.12em] text-arch-muted uppercase">
            <Sparkles size={12} />
            Agent
          </div>

          <button
            type="button"
            onClick={() => setShowAgentForm((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-lg border border-arch-border bg-black/20 px-2 py-1 text-[10px] text-arch-text transition hover:bg-white/5"
          >
            <Plus size={12} />
            新增
          </button>
        </div>

        {showAgentForm && (
          <div className="mb-3 space-y-2 rounded-xl border border-arch-border bg-black/20 p-3">
            <input
              value={newAgent.name}
              onChange={(e) => setNewAgent((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Agent 名称"
              className="w-full rounded-lg border border-arch-border bg-black/25 px-2.5 py-1.5 text-xs text-arch-text outline-none transition focus:border-arch-accent"
            />
            <input
              value={newAgent.model}
              onChange={(e) => setNewAgent((prev) => ({ ...prev, model: e.target.value }))}
              placeholder="模型（可不填）"
              className="w-full rounded-lg border border-arch-border bg-black/25 px-2.5 py-1.5 text-xs text-arch-text outline-none transition focus:border-arch-accent"
            />
            <textarea
              value={newAgent.description}
              onChange={(e) =>
                setNewAgent((prev) => ({ ...prev, description: e.target.value }))
              }
              placeholder="Agent 简介（可选）"
              rows={2}
              className="w-full rounded-lg border border-arch-border bg-black/25 px-2.5 py-1.5 text-xs text-arch-text outline-none transition focus:border-arch-accent"
            />
            <textarea
              value={newAgent.prompt}
              onChange={(e) => setNewAgent((prev) => ({ ...prev, prompt: e.target.value }))}
              placeholder="系统提示词（可选）"
              rows={3}
              className="w-full rounded-lg border border-arch-border bg-black/25 px-2.5 py-1.5 text-xs text-arch-text outline-none transition focus:border-arch-accent"
            />
            <button
              type="button"
              onClick={handleAddAgent}
              className="w-full rounded-lg bg-arch-accent px-2 py-1.5 text-[11px] font-medium text-white transition hover:brightness-110"
            >
              保存 Agent
            </button>
          </div>
        )}

        <div className="space-y-2 overflow-auto">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className={cn(
                'flex items-center gap-2 rounded-xl border p-2 transition',
                activeAgent.id === agent.id
                  ? 'border-arch-accent/60 bg-arch-accent/10'
                  : 'border-arch-border bg-black/10 hover:bg-white/5',
              )}
            >
              <button
                type="button"
                onClick={() => setActiveAgentId(agent.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: agent.accent }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-arch-text">
                    {agent.name}
                  </span>
                  <span className="block truncate text-[10px] text-arch-muted">
                    {agent.model || config.model}
                  </span>
                  {agent.description && (
                    <span className="mt-0.5 block line-clamp-2 text-[9px] leading-relaxed text-arch-muted/80">
                      {agent.description}
                    </span>
                  )}
                </span>
              </button>

              {agents.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleRemoveAgent(agent.id)}
                  className="rounded-lg p-1 text-arch-muted transition hover:bg-red-500/10 hover:text-red-400"
                  aria-label={`删除 ${agent.name}`}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-arch-border bg-black/10 p-3">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-medium tracking-[0.12em] text-arch-muted uppercase">
            <Wand2 size={12} />
            快捷提问
          </div>

          <div className="space-y-1.5">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => setInput(prompt)}
                className="block w-full rounded-lg border border-arch-border bg-black/10 px-2 py-1.5 text-left text-[11px] text-arch-muted transition hover:bg-white/5 hover:text-arch-text"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-arch-border bg-arch-panel/50 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: activeAgent.accent }}
            />
            <div>
              <div className="text-sm font-medium text-arch-text">{activeAgent.name}</div>
              <div className="text-[10px] text-arch-muted">
                {activeAgent.model || config.model} · {todayLabel}
              </div>
              {activeAgent.description && (
                <div className="mt-0.5 max-w-md truncate text-[9px] text-arch-muted/80">
                  {activeAgent.description}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={resetConversation}
              className="inline-flex items-center gap-1 rounded-full border border-arch-border bg-black/20 px-2 py-1 text-[10px] text-arch-muted transition hover:bg-white/5"
            >
              <RefreshCcw size={11} />
              新会话
            </button>
            <div className="rounded-full border border-arch-border bg-black/20 px-2 py-1 text-[10px] text-arch-muted">
              {canSend ? '已就绪' : '等待 API 配置'}
            </div>
          </div>
        </header>

        <div className="flex items-center justify-between border-b border-arch-border bg-arch-panel/30 px-4 py-2">
          <div className="flex items-center gap-2 text-[11px] text-arch-muted">
            <MessageSquareText size={12} />
            当前 Agent：{activeAgent.name}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-arch-muted">
            <Zap size={11} />
            {messages.length - 1} 条消息
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  'max-w-[85%] rounded-2xl border px-3 py-2 text-sm leading-relaxed shadow-sm',
                  message.role === 'user'
                    ? 'ml-auto border-arch-accent/40 bg-arch-accent/10 text-arch-text'
                    : 'border-arch-border bg-black/10 text-arch-text',
                )}
              >
                {message.content}
              </div>
            ))}

            {error && (
              <div className="rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {error}
              </div>
            )}

            {isLoading && (
              <div className="max-w-[85%] rounded-2xl border border-arch-border bg-black/10 px-3 py-2 text-xs text-arch-muted">
                助手正在思考…
              </div>
            )}
          </div>
        </div>

        <footer className="border-t border-arch-border bg-arch-panel/50 p-3">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <div className="flex min-h-[44px] flex-1 items-end rounded-2xl border border-arch-border bg-black/20 px-3 py-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                rows={1}
                placeholder="输入你的问题…"
                className="min-h-[24px] flex-1 resize-none bg-transparent text-sm text-arch-text outline-none placeholder:text-arch-muted"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!canSend}
              className={cn(
                'inline-flex h-11 w-11 items-center justify-center rounded-2xl text-white transition',
                canSend ? 'bg-arch-accent hover:brightness-110' : 'cursor-not-allowed bg-arch-border',
              )}
              aria-label="发送消息"
            >
              <SendHorizontal size={16} />
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
}
