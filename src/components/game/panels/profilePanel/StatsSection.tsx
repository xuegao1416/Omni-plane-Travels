import { Newspaper } from 'lucide-react';
import { Collapsible } from '../../../shared/Collapsible';
import { InfoItem } from './shared';
import type { GameState } from './types';

interface Props {
  world: GameState['世界'];
}

export function StatsSection({ world }: Props) {
  return (
    <>
      {/* 信息层级 */}
      <Collapsible icon={<Newspaper size={15} />} title="信息层级" defaultOpen={false}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {world.信息层级.全局重大事件 && <InfoItem label="全局" text={world.信息层级.全局重大事件} />}
          {world.信息层级.区域事件 && <InfoItem label="区域" text={world.信息层级.区域事件} />}
          {world.信息层级.本地消息 && <InfoItem label="本地" text={world.信息层级.本地消息} />}
          {world.信息层级.圈内传闻 && <InfoItem label="传闻" text={world.信息层级.圈内传闻} />}
        </div>
      </Collapsible>
    </>
  );
}
