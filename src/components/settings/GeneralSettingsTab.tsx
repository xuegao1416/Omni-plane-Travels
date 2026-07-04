import { Globe, Palette, Type } from 'lucide-react';
import { useUISettings, type Theme, type FontFamily, type FontSize, type LineHeight } from '../../context/UISettingsContext';
import { Section, SettingRow, SegmentedControl, Select, Toggle } from './SettingsUIComponents';

export default function GeneralSettingsTab() {
  const { settings: ui, update, t } = useUISettings();

  return (
    <div style={{ maxWidth: '560px' }}>
      <Section icon={<Globe size={15} />} title={t('settings.language')}>
        <SettingRow label={t('settings.language')}>
          <SegmentedControl
            options={[{ label: '简体中文', value: 'zh-CN' }, { label: 'English', value: 'en' }]}
            value={ui.language}
            onChange={v => update('language', v as any)}
          />
        </SettingRow>
      </Section>

      <Section icon={<Palette size={15} />} title={t('settings.theme')}>
        <SettingRow label={t('settings.theme')}>
          <SegmentedControl
            options={[
              { label: t('theme.light'), value: 'light' },
              { label: t('theme.dark'), value: 'dark' },
              { label: t('theme.metal'), value: 'metal' },
              { label: t('theme.green'), value: 'green' },
            ]}
            value={ui.theme}
            onChange={v => update('theme', v as Theme)}
          />
        </SettingRow>
      </Section>

      <Section icon={<Type size={15} />} title="排版">
        <SettingRow label={t('settings.font')}>
          <Select
            options={[
              { label: t('font.yahei'), value: 'yahei' },
              { label: t('font.source'), value: 'source' },
            ]}
            value={ui.font}
            onChange={v => update('font', v as FontFamily)}
            width="120px"
          />
        </SettingRow>
        <SettingRow label={t('settings.bodyFontSize')} desc={t('settings.bodyFontSize.desc')}>
          <SegmentedControl
            options={[
              { label: t('common.small'), value: '小' },
              { label: t('common.medium'), value: '中' },
              { label: t('common.large'), value: '大' },
            ]}
            value={ui.bodyFontSize}
            onChange={v => update('bodyFontSize', v as FontSize)}
          />
        </SettingRow>
        <SettingRow label={t('settings.lineHeight')}>
          <SegmentedControl
            options={[
              { label: t('common.compact'), value: '紧凑' },
              { label: t('common.comfortable'), value: '舒适' },
              { label: t('common.loose'), value: '宽松' },
            ]}
            value={ui.lineHeight}
            onChange={v => update('lineHeight', v as LineHeight)}
          />
        </SettingRow>
        <SettingRow label={t('settings.autoScroll')}>
          <Toggle value={ui.autoScroll} onChange={v => update('autoScroll', v)} />
        </SettingRow>
      </Section>
    </div>
  );
}
