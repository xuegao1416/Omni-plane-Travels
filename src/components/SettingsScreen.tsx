import { useState, useRef, useCallback, useEffect } from 'react';
import { Palette, Cpu, ImageIcon, FileText } from 'lucide-react';
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
import DawnFrameV4 from './shared/dawn/DawnFrameV4';

type SettingsTab = 'general' | 'api' | 'image' | 'preset';

const SETTINGS_TABS: { id: SettingsTab; icon: LucideIcon; label: string }[] = [
  { id: 'general', icon: Palette, label: '通用设置' },
  { id: 'api', icon: Cpu, label: 'API 设置' },
  { id: 'image', icon: ImageIcon, label: '生图设置' },
  { id: 'preset', icon: FileText, label: '预设管理' },
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
    <div className={`settings-screen${isMobile ? ' settings-screen--mobile' : ''}`}>
      <DawnFrameV4 mode="panel" withFill className="settings-screen__frame" ariaLabel={t('settings.title')}>
        <header className="settings-screen__header">
          <button
            className="settings-screen__back btn-ghost btn-icon"
            onClick={goBack}
            aria-label={t('settings.back')}
            title={t('settings.back')}
          >
            <img src="/art/theme/emblems/emblem-27-v2.png" alt="" aria-hidden="true" />
          </button>
          <h1>{t('settings.title')}</h1>
        </header>

        {isMobile && (
          <nav className="settings-mobile-tabs" aria-label={t('settings.title')}>
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
          </nav>
        )}

        <div className="settings-screen__body">
          {!isMobile && (
            <nav className="settings-screen__sidebar" aria-label={t('settings.title')}>
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
            </nav>
          )}

          <main className="settings-screen__scroll">
            <div className="settings-screen__content">
              {tab === 'general' && <GeneralSettingsTab />}
              {tab === 'api' && <ApiSettingsTab ref={apiRef} initialConfig={apiConfig} t={t} onSave={handleSave} onBack={goBack} />}
              {tab === 'image' && <ImageGenSettingsTab />}
              {tab === 'preset' && <PresetSettingsTab />}
            </div>
          </main>
        </div>

        {tab !== 'api' && (
          <footer className="settings-screen__footer">
            <button className="btn-secondary" onClick={goBack}>取消</button>
            <button className="btn-primary" onClick={handleSave}>{t('settings.save')}</button>
          </footer>
        )}
      </DawnFrameV4>
    </div>
  );
}
