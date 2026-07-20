/**
 * 用户中心页面
 * 未登录 → 登录表单
 * 已登录 → 3 个 Tab：个人中心 / 云存档 / 创意工坊
 */
import { useState } from 'react';
import { ArrowLeft, User, Cloud, Store } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useGame } from '../context/GameContext';
import { useAuthStore } from '../stores/authStore';
import { useIsPhone } from '../hooks/useIsMobile';
import AuthSettingsTab from './settings/AuthSettingsTab';
import CloudSaveSettingsTab from './settings/CloudSaveSettingsTab';
import WorkshopSettingsTab from './settings/WorkshopSettingsTab';

type UserTab = 'profile' | 'cloud' | 'workshop';

const USER_TABS: { id: UserTab; icon: LucideIcon; label: string }[] = [
  { id: 'profile', icon: User, label: '个人中心' },
  { id: 'cloud', icon: Cloud, label: '云存档' },
  { id: 'workshop', icon: Store, label: '创意工坊' },
];

export default function UserCenterPage() {
  const { goBack } = useGame();
  const { isAuthenticated, isLoading } = useAuthStore();
  const isMobile = useIsPhone();
  const [tab, setTab] = useState<UserTab>('profile');

  // 未登录或加载中 → 显示登录表单
  if (!isAuthenticated && !isLoading) {
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
            返回
          </button>
          <h1 style={{ fontSize: 'var(--font-size-xl)', fontWeight: '600' }}>登录</h1>
        </div>

        {/* 登录表单 */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <AuthSettingsTab />
        </div>
      </div>
    );
  }

  // 已登录 → 3 个 Tab
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
          返回
        </button>
        <h1 style={{ fontSize: 'var(--font-size-xl)', fontWeight: '600' }}>用户中心</h1>
      </div>

      {/* 移动端：顶部标签页 */}
      {isMobile && (
        <div className="settings-mobile-tabs">
          {USER_TABS.map(t => {
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
            {USER_TABS.map(t => {
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
          display: 'flex',
          flexDirection: 'column',
        }}>
          {tab === 'profile' && <AuthSettingsTab />}
          {tab === 'cloud' && <CloudSaveSettingsTab />}
          {tab === 'workshop' && <WorkshopSettingsTab />}
        </div>
      </div>
    </div>
  );
}
