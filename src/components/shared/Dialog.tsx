import { useState,useCallback } from 'react';
import { AlertTriangle,Info,HelpCircle,Loader2 } from 'lucide-react';
import { useConfigStore } from '../../stores/configStore';
import OverlayPortal from './OverlayPortal';
import PlanarFrame from '../../ui/planar/PlanarFrame';
import { Seal } from '../../ui/planar/Ornaments';
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

  const glyph = dialog?.type === 'loading'
    ? <Loader2 className={s.spinIcon} />
    : dialog?.danger ? <AlertTriangle /> : dialog?.type === 'alert' ? <AlertTriangle /> : dialog?.type === 'info' ? <Info /> : <HelpCircle />;

  const DialogUI = dialog?.open ? (
    <OverlayPortal
      className="pk-dialog-overlay"
      ariaLabel={dialog.title || t(`dialog.${dialog.type}`)}
      onClose={dialog.type === 'loading' ? undefined : () => close(false)}
      closeOnBackdrop={dialog.type !== 'loading'}
      closeOnEscape={dialog.type !== 'loading'}
    >
      <PlanarFrame className="pk-dialog" gem={dialog.danger ? 'garnet' : 'amber'} onClick={e => e.stopPropagation()}>
        <Seal tone={dialog.danger ? 'danger' : 'brass'} size={68} style={{ marginTop: -4 }}>{glyph}</Seal>
        <h2 className="pk-title pk-dialog__title">{dialog.title || t(`dialog.${dialog.type}`)}</h2>
        <p className="pk-dialog__message">{dialog.message}</p>

        {dialog.type === 'prompt' && (
          <div className="pk-dialog__prompt">
            <textarea
              value={dialog.inputValue || ''}
              onChange={e => setInputValue(e.target.value)}
              placeholder={dialog.placeholder || ''}
              autoFocus
              className="pk-input"
              rows={4}
            />
          </div>
        )}

        {dialog.type !== 'loading' && (
          <div className="pk-dialog__actions">
            {(dialog.type === 'confirm' || dialog.type === 'prompt') && (
              <button type="button" className="pk-btn pk-btn--secondary" onClick={() => close(false)}>
                {dialog.cancelText || t('common.cancel')}
              </button>
            )}
            <button
              type="button"
              onClick={() => close(true)}
              autoFocus={dialog.type !== 'prompt'}
              className={`pk-btn ${dialog.danger ? 'pk-btn--danger' : 'pk-btn--primary'}`}
            >
              {dialog.confirmText || (dialog.type === 'confirm' ? t('common.confirm') : t('dialog.gotIt'))}
            </button>
          </div>
        )}
      </PlanarFrame>
    </OverlayPortal>
  ) : null;

  return { DialogUI, confirm, alert, prompt, loading, close: () => close(false), isOpen: Boolean(dialog?.open) };
}
