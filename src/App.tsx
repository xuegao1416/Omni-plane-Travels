import { GameProvider, useGame } from './context/GameContext';
import { UISettingsProvider } from './context/UISettingsContext';
import ErrorBoundary from './components/ErrorBoundary';
import StartScreen from './components/start/StartScreen';
import SettingsScreen from './components/SettingsScreen';
import GameScreen from './components/game/GameScreen';
import EventsScreen from './components/event/EventsScreen';

function AppContent() {
  const { state } = useGame();
  switch (state.currentScreen) {
    case 'settings': return <SettingsScreen />;
    case 'events': return <EventsScreen />;
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
