import { useConfigStore,type UITheme } from '../stores/configStore';

/** Current interface theme ('night' | 'dawn'), for components whose drawing differs per theme. */
export function useUITheme(): UITheme {
  return useConfigStore(state => state.settings.uiTheme) ?? 'night';
}
