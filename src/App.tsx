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

function AppContent() {
  const { state } = useGame();
  const checkAuth = useAuthStore(s => s.checkAuth);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  switch (state.currentScreen) {
    case 'settings': return <SettingsScreen />;
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
      </UISettingsProvider>
    </ErrorBoundary>
  );
}
