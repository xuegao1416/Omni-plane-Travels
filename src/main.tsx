import { createRoot } from 'react-dom/client';
import App from './App';
import { initPlayTracker } from './modules/playTracker';

initPlayTracker();

createRoot(document.getElementById('root')!).render(<App />);
