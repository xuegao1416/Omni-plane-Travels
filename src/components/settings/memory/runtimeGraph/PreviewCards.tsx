import type { NarrativeMemoryRuntime, VectorMemoryItem } from '../../../../memory/types';
import { Button } from '../../SettingsUIComponents';
import { cardStyle, metaLineStyle } from './constants';
import { formatDateTime, formatRange } from './utils';

interface PreviewCardsProps {
  rt: NarrativeMemoryRuntime | null;
  isSimple: boolean;
  config: { writePipeline: { saveSummaryAfterIngest: boolean } };
  vectorMemory: VectorMemoryItem[];
  onOpenVectorExtract: () => void;
}

function MetaLine({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={metaLineStyle}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <strong style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{String(value)}</strong>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px',
      borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)',
      background: 'var(--accent-dim)', color: 'var(--accent)',
      border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
    }}>
      {children}
    </span>
  );
}

export function PreviewCards({ rt, isSimple, config, vectorMemory, onOpenVectorExtract }: PreviewCardsProps) {
  const lastSummary = rt?.lastSummarySave;
  const summaryApplyResult = lastSummary?.applyResult as Record<string, number> | undefined;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
      {/* 最近摘要写入概览 */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', fontSize: 'var(--font-size-base)', fontWeight: '600', borderBottom: '1px solid var(--border)' }}>
          <span>最近摘要写入概览</span>
          <div style={{ display: 'flex', gap: '5px' }}>
            <Tag>角色 {summaryApplyResult?.otherCharacterCount ?? 0}</Tag>
            <Tag>玩家 {summaryApplyResult?.playerCount ?? 0}</Tag>
            <Tag>物件 {summaryApplyResult?.itemCount ?? 0}</Tag>
          </div>
        </div>
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <MetaLine label="保存时间" value={formatDateTime(lastSummary?.savedAt)} />
          <MetaLine label="源范围" value={formatRange(lastSummary?.sourceStartIndex, lastSummary?.sourceEndIndex)} />
          <MetaLine label="角色记忆数" value={summaryApplyResult?.otherCharacterCount ?? 0} />
          <MetaLine label="玩家记忆数" value={summaryApplyResult?.playerCount ?? 0} />
          <MetaLine label="物件记忆数" value={summaryApplyResult?.itemCount ?? 0} />
        </div>
      </div>

      {/* 向量提取概览 / 检索规划概览 */}
      {isSimple ? (
        <div style={cardStyle}>
          <div style={{ padding: '12px 16px', fontSize: 'var(--font-size-base)', fontWeight: '600', borderBottom: '1px solid var(--border)' }}>
            <span>最近检索规划概览</span>
          </div>
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <MetaLine label="规划时间" value={formatDateTime(rt?.lastRetrievePlan?.plannedAt)} />
            <MetaLine label="联合候选" value={rt?.lastRetrievePlan?.candidates?.length ?? 0} />
            <MetaLine label="入选标题数" value={rt?.lastRetrievePlan?.selectedTitles?.length ?? 0} />
          </div>
        </div>
      ) : (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', fontSize: 'var(--font-size-base)', fontWeight: '600', borderBottom: '1px solid var(--border)' }}>
            <span>向量提取概览</span>
            <Button onClick={onOpenVectorExtract}>手动提取</Button>
          </div>
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <MetaLine label="事实库总量" value={`${vectorMemory.length} 条`} />
            <MetaLine label="最近提取游标" value={rt?.lastIngestCursor ?? 0} />
            <MetaLine label="最近摘要生成" value={formatDateTime(lastSummary?.savedAt)} />
          </div>
        </div>
      )}

      {/* 热态同步概览 */}
      <div style={cardStyle}>
        <div style={{ padding: '12px 16px', fontSize: 'var(--font-size-base)', fontWeight: '600', borderBottom: '1px solid var(--border)' }}>
          <span>热态同步概览</span>
        </div>
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <MetaLine label="写入游标" value={rt?.lastIngestCursor ?? 0} />
          <MetaLine label="最近成功写入" value={formatDateTime(rt?.lastIngestSuccessAt)} />
          <MetaLine label="最近写入尝试" value={formatDateTime(rt?.lastIngestAttemptAt)} />
          <MetaLine label="最近重建时间" value={formatDateTime(rt?.lastRebuildAt)} />
          {rt?.lastIngestFailure?.message && (
            <div style={{ marginTop: 8, textAlign: 'left', fontSize: 12, color: 'var(--text-muted)', padding: '16px', border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)', lineHeight: 1.6 }}>
              最近失败：{rt.lastIngestFailure.message}
            </div>
          )}
        </div>
      </div>

      {/* 摘要同步概览 */}
      <div style={cardStyle}>
        <div style={{ padding: '12px 16px', fontSize: 'var(--font-size-base)', fontWeight: '600', borderBottom: '1px solid var(--border)' }}>
          <span>摘要同步概览</span>
        </div>
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <MetaLine label="摘要保存" value={config.writePipeline.saveSummaryAfterIngest ? '已启用' : '已关闭'} />
          <MetaLine label="总记录数" value={rt?.summarySaveHistory?.length ?? 0} />
          <MetaLine label="最近摘要时间" value={formatDateTime(lastSummary?.savedAt)} />
        </div>
      </div>
    </div>
  );
}
