// 角色头像 URL 响应式 Store
// 上传/生成头像时写入，InlineDialogueCard 等组件订阅后自动更新
import { create } from 'zustand';

interface PortraitStoreState {
  /** npcId → objectURL 映射 */
  portraits: Record<string, string>;
  /** 设置头像（上传/生成后调用） */
  setPortrait: (npcId: string, url: string) => void;
  /** 清除头像 */
  clearPortrait: (npcId: string) => void;
}

export const usePortraitStore = create<PortraitStoreState>((set) => ({
  portraits: {},

  setPortrait: (npcId, url) =>
    set((state) => ({
      portraits: { ...state.portraits, [npcId]: url },
    })),

  clearPortrait: (npcId) =>
    set((state) => {
      const { [npcId]: _, ...rest } = state.portraits;
      return { portraits: rest };
    }),
}));
