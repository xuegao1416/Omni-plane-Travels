import { useState, useCallback, useRef, useEffect } from 'react';
import { AlertTriangle, Info, HelpCircle, X, Loader2 } from 'lucide-react';
import { useConfigStore } from '../../stores/configStore';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import s from './Dialog.module.css';

interface DialogOptions {
  type: 'confirm' | 'alert' | 'info' | 'prompt' | 'loading';
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  defaultValue?: string;
  placeholder?: string;
}

interface DialogState extends DialogOptions {
  open: boolean;
  resolve: (value: any) => void;
  inputValue?: string;
}

export function useDialog() {
  const t = useConfigStore(s => s.t);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const confirm = useCallback((message: string, options?: Partial<Omit<DialogOptions, 'type' | 'message'>>): Promise<boolean> => {
    return new Promise(resolve => {
      setDialog({ type: 'confirm', message, open: true, resolve, ...options });
    });
  }, []);

  const alert = useCallback((message: string, options?: Partial<Omit<DialogOptions, 'type' | 'message'>>): Promise<void> => {
    return new Promise(resolve => {
      setDialog({
        type: 'alert', message, open: true,
        resolve: () => resolve(),
        ...options,
      });
    });
  }, []);

  const prompt = useCallback((message: string, options?: Partial<Omit<DialogOptions, 'type' | 'message' | 'resolve'>>): Promise<string | null> => {
    return new Promise(resolve => {
      setDialog({
        type: 'prompt', message, open: true,
        inputValue: options?.defaultValue || '',
        resolve: (val: string | null) => resolve(val),
        ...options,
      });
    });
  }, []);

  const loading = useCallback((message: string, options?: Partial<Omit<DialogOptions, 'type' | 'message'>>): void => {
    setDialog({ type: 'loading', message, open: true, resolve: () => {}, ...options });
  }, []);

  const close = useCallback((result: boolean) => {
    if (dialog?.type === 'prompt') {
      dialog.resolve(result ? (dialog.inputValue ?? '') : null);
    } else {
      dialog?.resolve(result);
    }
    setDialog(null);
  }, [dialog]);

  const setInputValue = useCallback((val: string) => {
    setDialog(prev => prev ? { ...prev, inputValue: val } : null);
  }, []);

  // ESC 关闭
  useEffect(() => {
    if (!dialog?.open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dialog.type !== 'loading') close(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dialog?.open, dialog?.type, close]);

  const iconMap = {
    confirm: HelpCircle,
    alert: AlertTriangle,
    info: Info,
    prompt: HelpCircle,
    loading: Loader2,
  };

  useBodyScrollLock(!!dialog?.open);

  const DialogUI = dialog?.open ? (
    <div ref={dialogRef} className={s.overlay} onClick={() => { if (dialog.type !== 'loading') close(false); }}>
      <div className={s.dialog} onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div className={s.header}>
          {(() => {
            const Icon = iconMap[dialog.type];
            return (
              <div className={`${s.iconBox} ${dialog.danger ? s.iconBoxDanger : s.iconBoxDefault}`}>
                <Icon
                  size={16}
                  color={dialog.danger ? 'var(--danger)' : 'var(--accent, #d4af37)'}
                  className={dialog.type === 'loading' ? s.spinIcon : undefined}
                />
              </div>
            );
          })()}
          <span className={s.dialogTitle}>
            {dialog.title || t(`dialog.${dialog.type}`)}
          </span>
        </div>

        {/* 内容 */}
        <div className={s.message}>{dialog.message}</div>

        {/* Prompt 输入框 */}
        {dialog.type === 'prompt' && (
          <div className={s.promptWrap}>
            <textarea
              value={dialog.inputValue || ''}
              onChange={e => setInputValue(e.target.value)}
              placeholder={dialog.placeholder || ''}
              autoFocus
              className={s.promptInput}
              rows={4}
            />
          </div>
        )}

        {/* 按钮（loading 类型不显示） */}
        {dialog.type !== 'loading' && (
          <div className={s.actions}>
            {(dialog.type === 'confirm' || dialog.type === 'prompt') && (
              <button className={s.cancelBtn} onClick={() => close(false)}>
                {dialog.cancelText || t('common.cancel')}
              </button>
            )}
            <button
              onClick={() => close(true)}
              autoFocus
              className={`${s.confirmBtn} ${dialog.danger ? s.confirmBtnDanger : s.confirmBtnDefault}`}
            >
              {dialog.confirmText || (dialog.type === 'confirm' ? t('common.confirm') : t('dialog.gotIt'))}
            </button>
          </div>
        )}
      </div>
    </div>
  ) : null;

  return { DialogUI, confirm, alert, prompt, loading, close: () => close(false) };
}
