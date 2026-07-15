import { lazy, Suspense } from 'react';
import { GameProvider, useGame } from './context/GameContext';
import { UISettingsProvider } from './context/UISettingsContext';
import ErrorBoundary from './components/ErrorBoundary';
import StartScreen from './components/start/StartScreen';
import SettingsScreen from './components/SettingsScreen';
import GameScreen from './components/game/GameScreen';
// P1-5：事件子树（含 @xyflow/react / jszip 等重依赖）改为按需加载，
// 从主包剥离到独立 chunk，首屏不再为事件中心买单。
const EventsScreen = lazy(() => import('./components/event/EventsScreen'));

function AppContent() {
  const { state } = useGame();
  switch (state.currentScreen) {
    case 'settings': return <SettingsScreen />;
    case 'mods': return (
      <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--text-muted)' }}>载入事件中心…</div>}>
        <EventsScreen />
      </Suspense>
    );
    case 'game': return <GameScreen />;
    default: return <StartScreen />;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <UISettingsProvider>
        <GameProvider>
          <AppContent />
        </GameProvider>
      </UISettingsProvider>
    </ErrorBoundary>
  );
}
