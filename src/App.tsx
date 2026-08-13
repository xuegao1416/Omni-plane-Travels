import { useEffect } from 'react';
import { GameProvider, useGame } from './context/GameContext';
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

  if (state.currentScreen === 'settings') {
    const previousScreen = state.screenHistory[state.screenHistory.length - 1];
    return (
      <div className="settings-route">
        {previousScreen === 'game' ? <GameScreen /> : <StartScreen />}
        <SettingsScreen />
      </div>
    );
  }

  switch (state.currentScreen) {
    case 'events': return <EventsScreen />;
    case 'game': return <GameScreen />;
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
