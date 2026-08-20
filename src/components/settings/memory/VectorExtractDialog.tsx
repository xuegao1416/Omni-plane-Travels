import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { fetchEmbeddingBatch } from '../../../api/client';
import { extractContentForPrompt } from '../../../engine/responseExtractor';
import type { ChatMessage } from '../../../engine/types';
import { useMemoryStore } from '../../../memory/memoryStore';
import type { MemorySystemConfig, VectorMemoryItem } from '../../../memory/types';
import { Button } from '../SettingsUIComponents';

interface Props {
  onClose: () => void;
  onComplete: () => void;
  messages: ChatMessage[];
  config: MemorySystemConfig;
}

const inputStyle: React.CSSProperties = {
  padding: '7px 10px', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)', background: 'var(--bg-primary)',
  color: 'var(--text-primary)', fontSize: 'var(--font-size-base)', outline: 'none',
  width: '100%', transition: 'border-color 0.15s, box-shadow 0.15s',
};

function compactNarrative(text: string, maxLength: number): string {
  const normalized = text.replace(/\n{3,}/g, '\n\n').trim();
  if (normalized.length <= maxLength) return normalized;
  const headLength = Math.floor(maxLength * 0.65);
  return `${normalized.slice(0, headLength)}\n……[中段省略]……\n${normalized.slice(-(maxLength - headLength))}`;
}

function buildRoundDocuments(messages: ChatMessage[], start: number, end: number) {
  const byRound = new Map<number, { user: string[]; assistant: string[] }>();
  for (const message of messages) {
    if (message.round < start || message.round > end) continue;
    const text = message.role === 'assistant'
      ? extractContentForPrompt(message.rawText || '')
      : (message.rawText || '').trim();
    if (!text || text.startsWith('[错误]') || text === '[已停止生成]') continue;
    const round = byRound.get(message.round) ?? { user: [], assistant: [] };
    round[message.role].push(text);
    byRound.set(message.round, round);
  }

  return [...byRound.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, content]) => ({
      round,
      text: compactNarrative([
        content.user.length > 0 ? `【玩家】${content.user.join('\n')}` : '',
        content.assistant.length > 0 ? `【剧情】${content.assistant.join('\n')}` : '',
      ].filter(Boolean).join('\n'), 2200),
    }))
    .filter(item => item.text.length > 0);
}

export function VectorExtractDialog({ onClose, onComplete, messages, config }: Props) {
  const availableRange = useMemo(() => {
    const rounds = messages.map(message => message.round).filter(round => Number.isFinite(round) && round > 0);
    const max = rounds.length > 0 ? Math.max(...rounds) : 1;
    const min = rounds.length > 0 ? Math.min(...rounds) : 1;
    return { min, max, suggestedStart: Math.max(min, max - 499) };
  }, [messages]);
  const [start, setStart] = useState(availableRange.suggestedStart);
  const [end, setEnd] = useState(availableRange.max);
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleExtract = async () => {
    setExtracting(true);
    setResult(null);
    setProgress('');
    try {
      if (!config.vectorApiUrl.trim() || !config.vectorApiModel.trim()) {
        throw new Error('请先在向量化设置中填写 Embedding API 地址和模型。');
      }
      const from = Math.max(availableRange.min, Math.min(start, end));
      const to = Math.min(availableRange.max, Math.max(start, end));
      const documents = buildRoundDocuments(messages, from, to);
      if (documents.length === 0) throw new Error('所选范围内没有可重建的对话。');

      const embeddingConfig = {
        baseUrl: config.vectorApiUrl.trim(),
        apiKey: config.vectorApiKey.trim(),
        model: config.vectorApiModel.trim(),
      };
      const rebuilt: VectorMemoryItem[] = [];
      const batchSize = 32;
      for (let offset = 0; offset < documents.length; offset += batchSize) {
        const chunk = documents.slice(offset, offset + batchSize);
        setProgress(`正在重建 ${Math.min(offset + chunk.length, documents.length)} / ${documents.length} 轮…`);
        const embeddings = await fetchEmbeddingBatch(embeddingConfig, chunk.map(item => item.text));
        if (embeddings.length !== chunk.length) throw new Error('Embedding 返回数量与对话数量不一致。');
        const createdAt = Date.now();
        chunk.forEach((document, index) => {
          rebuilt.push({
            id: `history_round_${document.round}`,
            fact: document.text,
            summary: `第 ${document.round} 轮原始剧情索引`,
            searchText: document.text,
            keywords: [], entities: [], characters: [], locations: [], factions: [], items: [],
            abilities: [], events: [], rules: [], timeMarkers: [], secondaryTypes: [],
            primaryType: 'event', importance: 3, timeScope: 'long', state: 'active',
            sourceStartIndex: document.round, sourceEndIndex: document.round,
            createdAt, embedding: embeddings[index], embeddingTimestamp: createdAt,
          });
        });
      }

      const store = useMemoryStore.getState();
      store.setConfig({ ...config, vectorEnabled: true, semanticRetrieveEnabled: true });
      store.appendVectorMemories(rebuilt);
      const runtime = store.getMemoryRuntime();
      runtime.lastRebuildAt = Date.now();
      store.bumpRuntimeVersion();
      onComplete();
      setResult({ success: true, message: `已从原始对话重建 ${rebuilt.length} 轮记忆索引。` });
    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setExtracting(false);
      setProgress('');
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1600,
        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={() => !extracting && onClose()}
    >
      <div
        style={{
          width: '90%', maxWidth: 500, borderRadius: 'var(--radius-xl)',
          background: 'var(--bg-primary)', border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)', overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ paddingBottom: '14px', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: 'var(--font-size-xl)', fontWeight: '700', color: 'var(--text-primary)', margin: 0 }}>重建长期记忆</h3>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginTop: '6px' }}>
              从当前存档仍保留的原始对话重建语义索引，用于修复旧版本丢失的远期摘要。
            </p>
          </div>

          <div style={{ display: 'flex', gap: '16px' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', fontWeight: '600' }}>起始轮次</span>
              <input type="number" min={availableRange.min} max={availableRange.max} value={start} onChange={e => setStart(Number(e.target.value))} style={inputStyle} />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', fontWeight: '600' }}>结束轮次</span>
              <input type="number" min={availableRange.min} max={availableRange.max} value={end} onChange={e => setEnd(Number(e.target.value))} style={inputStyle} />
            </div>
          </div>

          {progress && <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>{progress}</div>}
          {result && (
            <div style={{
              padding: '10px 14px', borderRadius: 'var(--radius-md)',
              border: `1px solid ${result.success ? 'var(--success)' : 'var(--danger)'}`,
              background: `color-mix(in srgb, ${result.success ? 'var(--success)' : 'var(--danger)'} 10%, transparent)`,
              fontSize: 'var(--font-size-sm)', color: result.success ? 'var(--success)' : 'var(--danger)',
            }}>
              {result.message}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
            <Button disabled={extracting} onClick={onClose}>关闭</Button>
            <Button primary disabled={extracting || messages.length === 0} onClick={handleExtract} icon={<Sparkles size={14} />}>
              {extracting ? '重建中…' : '开始重建'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
