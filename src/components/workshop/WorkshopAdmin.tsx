import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronRight, EyeOff, ShieldCheck, X } from 'lucide-react';
import { describeWorkshopError, workshopApi } from '../../workshop/api';
import { WORKSHOP_REPORT_REASON_LABELS, type WorkshopReportRecord } from '../../workshop/protocol';
import { EmptyState, FeedbackNotice, Spinner, formatDate, useWorkshopAction } from './shared';

type ReportStatus = WorkshopReportRecord['status'];
const STATUS_LABELS: Record<ReportStatus, string> = { open: '待处理', resolved: '已处理', dismissed: '已驳回' };

/** 管理员：处理举报。设精选、下架/恢复在作品详情里。 */
export default function WorkshopAdmin({ onOpen }: { onOpen: (id: string) => void }) {
  const [status, setStatus] = useState<ReportStatus>('open');
  const [reports, setReports] = useState<WorkshopReportRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const { busy, feedback, setFeedback, run } = useWorkshopAction();

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setReports(await workshopApi.admin.reports(status));
    } catch (error) {
      setReports([]);
      setLoadError(describeWorkshopError(error));
    }
  }, [status]);
  useEffect(() => { setReports(null); void load(); }, [load]);

  const resolve = (report: WorkshopReportRecord, action: 'dismiss' | 'resolve', hideItem = false) => {
    void run(report.id, async () => {
      await workshopApi.admin.resolveReport(report.id, action, { note: notes[report.id]?.trim() || undefined, hideItem });
      await load();
    }, () => (action === 'dismiss' ? '已驳回举报' : hideItem ? '已认定属实并下架作品' : '已认定属实'));
  };

  return (
    <section className="ws-section" aria-label="举报处理">
      <div className="registry-type-tabs" role="group" aria-label="举报状态">
        {(Object.keys(STATUS_LABELS) as ReportStatus[]).map(entry => (
          <button type="button" key={entry} aria-pressed={status === entry} onClick={() => setStatus(entry)}>{STATUS_LABELS[entry]}</button>
        ))}
      </div>
      <FeedbackNotice feedback={feedback ?? (loadError ? { tone: 'error', message: loadError } : null)} onDismiss={() => setFeedback(null)} />
      {reports === null && <Spinner />}
      {reports?.length === 0 && !loadError && <EmptyState icon={ShieldCheck} title={status === 'open' ? '没有待处理的举报' : '暂无记录'} />}
      <ul className="ws-list">
        {reports?.map(report => (
          <li key={report.id} className="ws-row">
            <div className="ws-row__main">
              <span className="ws-tag-soft">{WORKSHOP_REPORT_REASON_LABELS[report.reason]}</span>
              <strong>{report.itemTitle}</strong>
              <small>{formatDate(report.createdAt)} · 举报人 {report.reporterId.slice(0, 8)}</small>
            </div>
            {report.detail && <p className="ws-row__note">{report.detail}</p>}
            {report.resolutionNote && <p className="ws-row__note">处理备注：{report.resolutionNote}</p>}
            <div className="ws-row__actions registry-card-actions">
              <button type="button" onClick={() => onOpen(report.itemId)}><ChevronRight size={14} />查看作品</button>
              {report.status === 'open' && (
                <>
                  <input className="pk-input ws-row__input" placeholder="处理备注（可选）" value={notes[report.id] ?? ''} onChange={event => setNotes(current => ({ ...current, [report.id]: event.target.value }))} />
                  <button type="button" disabled={busy !== null} onClick={() => resolve(report, 'dismiss')}><X size={14} />驳回</button>
                  <button type="button" disabled={busy !== null} onClick={() => resolve(report, 'resolve')}><Check size={14} />属实</button>
                  <button type="button" className="registry-action-danger" disabled={busy !== null} onClick={() => resolve(report, 'resolve', true)}><EyeOff size={14} />属实并下架</button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
