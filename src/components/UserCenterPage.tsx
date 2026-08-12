import { useState } from 'react';
import { ArrowLeft, Cloud, Package, ShieldCheck, Store, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useGame } from '../context/GameContext';
import { useAuthStore } from '../stores/authStore';
import AuthSettingsTab from './settings/AuthSettingsTab';
import CloudSaveSettingsTab from './settings/CloudSaveSettingsTab';
import WorkshopSettingsTab from './settings/WorkshopSettingsTab';
import LocalAssetsTab from './settings/LocalAssetsTab';
import DawnFrameV4 from './shared/dawn/DawnFrameV4';
import './traveler-registry.css';

type UserTab = 'profile' | 'cloud' | 'workshop' | 'assets';
const USER_TABS: { id: UserTab; icon: LucideIcon; label: string }[] = [
  { id: 'profile', icon: UserRound, label: '账号摘要' },
  { id: 'cloud', icon: Cloud, label: '云存档' },
  { id: 'workshop', icon: Store, label: '创意工坊' },
  { id: 'assets', icon: Package, label: '本地资产' },
];

interface RegistryPresentationProps { goBack: () => void; isAuthenticated: boolean; isLoading: boolean; user?: { username: string; email: string } | null }

export default function UserCenterPage() {
  return <ConnectedUserCenter />;
}

function ConnectedUserCenter() {
  const { goBack } = useGame();
  const { user, isAuthenticated, isLoading } = useAuthStore();
  return <RegistryPresentation goBack={goBack} isAuthenticated={isAuthenticated} isLoading={isLoading} user={user} />;
}

function RegistryPresentation({ goBack, isAuthenticated, isLoading, user }: RegistryPresentationProps) {
  const signedIn = isAuthenticated;
  const loading = isLoading;
  const effectiveUser = user;
  const [tab, setTab] = useState<UserTab>('profile');

  return (
    <div className="entry-default-theme traveler-registry-screen">
      <div className="traveler-registry-backdrop" aria-hidden="true" />
      <div className="traveler-registry-shell-wrap">
        <DawnFrameV4 mode="panel" withFill className="traveler-registry-frame" ariaLabel="旅者登记所">
          <div className="traveler-registry-shell">
            <header className="traveler-registry-header">
              <button type="button" className="traveler-registry-back" onClick={goBack} aria-label="返回旅庭"><ArrowLeft size={17} /><span>返回旅庭</span></button>
              <div className="traveler-registry-heading"><span>DAWN REGISTRY · IDENTITY MIRROR</span><h1>旅者登记所</h1><p>管理万象镜身份，以及云存档与创意工坊访问权。</p></div>
              <div className="traveler-registry-header-mark"><UserRound size={18} /></div>
            </header>
            {loading ? <div className="traveler-registry-loading"><div className="traveler-registry-spinner" /><strong>正在确认旅者身份</strong><span>请稍候，万象镜正在读取登记状态。</span></div> : !signedIn ? <div className="traveler-registry-auth-layout"><IdentityMirrorIntro /><section className="traveler-registry-auth-panel" aria-label="账号认证"><div className="traveler-registry-panel-heading"><span className="traveler-registry-kicker">IDENTITY MIRROR</span><h2>唤醒已有身份</h2><p>一组身份即可在不同旅庭继续保存与分享。</p></div><AuthSettingsTab /></section></div> : <SignedInRegistry user={effectiveUser ?? undefined} tab={tab} setTab={setTab} />}
          </div>
        </DawnFrameV4>
      </div>
    </div>
  );
}

function IdentityMirrorIntro() {
  return <section className="traveler-registry-identity" aria-label="万象镜身份说明"><div className="traveler-registry-portrait-frame"><img src="/art/theme/ui-kit/dawn-v4/portraits/portrait-silhouette-neutral-v1.png" alt="中性旅者剪影" /></div><span className="traveler-registry-kicker">THE IDENTITY MIRROR</span><h2>万象镜身份</h2><p>登录后，旅者可以在不同设备继续云存档，并访问创意工坊中的世界与人物资产。</p><ul><li><ShieldCheck size={15} />云存档与旅程同步</li><li><ShieldCheck size={15} />创意工坊导入与管理</li><li><ShieldCheck size={15} />账号状态由服务器安全保管</li></ul></section>;
}

function SignedInRegistry({ user, tab, setTab }: { user?: { username: string; email: string }; tab: UserTab; setTab: (tab: UserTab) => void }) {
  const authTabs = <nav className="traveler-registry-tabs" aria-label="账号分区" role="tablist">{USER_TABS.map(({ id, icon: Icon, label }) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}><Icon size={16} />{label}</button>)}</nav>;
  return <div className="traveler-registry-signed-layout">{authTabs}<main className="traveler-registry-signed-content">{tab === 'profile' && <AuthSettingsTab />}{tab === 'cloud' && <CloudSaveSettingsTab />}{tab === 'workshop' && <WorkshopSettingsTab />}{tab === 'assets' && <LocalAssetsTab />}</main></div>;
}
