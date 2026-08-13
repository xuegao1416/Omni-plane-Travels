import { useState } from 'react';
import { getPlayTrackingConsent, setPlayTrackingConsent } from '../modules/playTracker';
import styles from './TelemetryConsentBanner.module.css';

export default function TelemetryConsentBanner() {
  const [consent, setConsent] = useState(getPlayTrackingConsent);
  if (consent !== null) return null;

  const choose = (granted: boolean) => {
    setPlayTrackingConsent(granted);
    setConsent(granted ? 'granted' : 'denied');
  };

  return (
    <section className={styles.banner} aria-label="匿名使用统计选择">
      <div className={styles.copy}>
        <strong>帮我们了解游戏是否好用？</strong>
        <span>同意后仅发送匿名的游玩时长、到达页面、浏览器类型、屏幕尺寸和时区；不发送账号、IP、存档、对话或世界内容。数据最多保留 90 天。</span>
      </div>
      <div className={styles.actions}>
        <button className={styles.secondary} type="button" onClick={() => choose(false)}>暂不参与</button>
        <button className={styles.primary} type="button" onClick={() => choose(true)}>同意匿名统计</button>
      </div>
    </section>
  );
}
