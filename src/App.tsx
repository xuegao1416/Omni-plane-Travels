import { useEffect } from 'react';
import { GameProvider,useGame } from './context/GameContext';
import { UISettingsProvider } from './context/UISettingsContext';
import ErrorBoundary from './components/ErrorBoundary';
import StartScreen from './components/start/StartScreen';
import SettingsScreen from './components/SettingsScreen';
import GameScreen from './components/game/GameScreen';
import EventsScreen from './components/event/EventsScreen';
import UserCenterPage from './components/UserCenterPage';
import { useAuthStore } from './stores/authStore';
import { useAdaptiveTheme } from './theme/useAdaptiveTheme';
import { reportDepth } from './modules/playTracker';
import TelemetryConsentBanner from './components/TelemetryConsentBanner';

function AppContent() {
  const { state } = useGame();
  const checkAuth = useAuthStore(s => s.checkAuth);

  useAdaptiveTheme();

  useEffect(() => { checkAuth(); }, [checkAuth]);

  // 匿名游玩统计：报深度（home/lobby/wizard/game/events）
  useEffect(() => {
    if (state.currentScreen === 'game') reportDepth('game');
    else if (state.currentScreen === 'events') reportDepth('events');
    else reportDepth('home');
  }, [state.currentScreen]);

  const previousScreen = state.screenHistory[state.screenHistory.length - 1];
  const settingsOpen = state.currentScreen === 'settings';
  if (state.currentScreen === 'game' || (settingsOpen && previousScreen === 'game')) {
    return (
      <div className={settingsOpen ? 'settings-route' : undefined}>
        <div className={settingsOpen ? 'settings-route__background' : undefined} aria-hidden={settingsOpen || undefined} inert={settingsOpen}>
          <GameScreen />
        </div>
        {settingsOpen && <SettingsScreen />}
      </div>
    );
  }
  if (settingsOpen) {
    return (
      <div className="settings-route">
        <div className="settings-route__background" aria-hidden="true" inert>
          <StartScreen />
        </div>
        <SettingsScreen />
      </div>
    );
  }

  switch (state.currentScreen) {
    case 'events': return <EventsScreen />;
    case 'user-center': return <UserCenterPage />;
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
        <TelemetryConsentBanner />
      </UISettingsProvider>
    </ErrorBoundary>
  );
}
