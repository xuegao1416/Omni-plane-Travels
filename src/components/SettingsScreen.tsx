import { useState, useRef, useCallback, useEffect } from 'react';
import { Palette, Cpu, ArrowLeft, ImageIcon, FileText, User, Cloud, Store } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useGame } from '../context/GameContext';
import { useUISettings } from '../context/UISettingsContext';
import { useConfigStore } from '../stores/configStore';
import { useIsPhone } from '../hooks/useIsMobile';
import type { ApiConfig } from '../api/types';
import GeneralSettingsTab from './settings/GeneralSettingsTab';
import ApiSettingsTab, { type ApiSettingsRef } from './settings/ApiSettingsTab';
import ImageGenSettingsTab from './settings/ImageGenSettingsTab';
import PresetSettingsTab from './settings/PresetSettingsTab';
import AuthSettingsTab from './settings/AuthSettingsTab';
import CloudSaveSettingsTab from './settings/CloudSaveSettingsTab';
import WorkshopSettingsTab from './settings/WorkshopSettingsTab';

type SettingsTab = 'general' | 'api' | 'image' | 'preset' | 'auth' | 'cloud' | 'workshop';

const SETTINGS_TABS: { id: SettingsTab; icon: LucideIcon; label: string }[] = [
  { id: 'general', icon: Palette, label: '通常设置' },
  { id: 'api', icon: Cpu, label: 'API 设置' },
  { id: 'image', icon: ImageIcon, label: '生图设置' },
  { id: 'preset', icon: FileText, label: '预设管理' },
  { id: 'auth', icon: User, label: '账号' },
  { id: 'cloud', icon: Cloud, label: '云存档' },
  { id: 'workshop', icon: Store, label: '创意工坊' },
];

export default function SettingsScreen() {
  const { goBack } = useGame();
  const { t } = useUISettings();
  const isMobile = useIsPhone();
  const apiConfig = useConfigStore(s => s.apiConfig);
  const setApiConfig = useConfigStore(s => s.setApiConfig);
  const [tab, setTab] = useState<SettingsTab>('general');

  useEffect(() => {
    if (!SETTINGS_TABS.find(t => t.id === tab)) {
      setTab('general');
    }
  }, [tab]);

  const apiRef = useRef<ApiSettingsRef>(null);

  const handleSave = useCallback(() => {
    const apiValues = apiRef.current?.getValues();

    if (apiValues) {
      setApiConfig(apiValues.config);
    }

    goBack();
  }, [goBack, setApiConfig]);

  return (
    <div
      className="full-height"
      style={{
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* 头部 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: isMobile ? '12px 16px' : '16px 20px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        flexShrink: 0,
      }}>
        <button
          className="btn-ghost btn-sm"
          onClick={goBack}
          style={{
            background: 'var(--bg-tertiary)',
            minHeight: 'var(--touch-min)',
          }}
        >
          <ArrowLeft size={16} />
          {t('settings.back')}
        </button>
        <h1 style={{ fontSize: 'var(--font-size-xl)', fontWeight: '600' }}>{t('settings.title')}</h1>
      </div>

      {/* 移动端：顶部标签页 */}
      {isMobile && (
        <div className="settings-mobile-tabs">
          {SETTINGS_TABS.map(t => {
            const TabIcon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`settings-mobile-tab${tab === t.id ? ' active' : ''}`}
              >
                <TabIcon size={15} strokeWidth={1.5} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 主体：侧边栏 + 内容 */}
      <div style={{
        flex: 1,
        display: 'flex',
        overflow: 'hidden',
      }}>
        {/* 桌面端：左侧 Tab 栏 */}
        {!isMobile && (
          <div style={{
            width: '130px',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            padding: '12px 8px',
            gap: '4px',
            borderRight: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
          }}>
            {SETTINGS_TABS.map(t => {
              const TabIcon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`settings-tab-btn${tab === t.id ? ' active' : ''}`}
                >
                  <TabIcon size={15} strokeWidth={1.5} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* 内容 */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: isMobile ? '16px' : '20px 24px',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {tab === 'general' && <GeneralSettingsTab />}
          {tab === 'api' && <ApiSettingsTab ref={apiRef} initialConfig={apiConfig} t={t} onSave={handleSave} onBack={goBack} />}
          {tab === 'image' && <ImageGenSettingsTab />}
          {tab === 'preset' && <PresetSettingsTab />}
          {tab === 'auth' && <AuthSettingsTab />}
          {tab === 'cloud' && <CloudSaveSettingsTab />}
          {tab === 'workshop' && <WorkshopSettingsTab />}
        </div>
      </div>

      {/* 底部保存按钮（API tab 有自己的按钮，此处隐藏） */}
      {tab !== 'api' && (
        <div style={{
          padding: isMobile ? '12px 16px' : '12px 24px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '10px',
          flexShrink: 0,
        }}>
          <button
            className="btn-secondary"
            onClick={goBack}
            style={{ minHeight: 'var(--touch-min)' }}
          >
            取消
          </button>
          <button
            className="btn-primary"
            onClick={handleSave}
            style={{ minHeight: 'var(--touch-min)', padding: '8px 28px' }}
          >
            {t('settings.save')}
          </button>
        </div>
      )}
    </div>
  );
}
