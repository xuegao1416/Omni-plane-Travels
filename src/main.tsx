import { createRoot } from 'react-dom/client';
import { lazy,Suspense } from 'react';
import App from './App';
import PlanarDefs from './ui/planar/PlanarDefs';
import { initPlayTracker } from './modules/playTracker';
import { restoreVisualTheme } from './workshop/visualTheme';
import { applyDevScreenshotPreset,isCombatPreview,isGameShellPreview,isKitPreview,isMapPreview,isWorkshopPreview } from './dev/screenshotPreset';

applyDevScreenshotPreset();
initPlayTracker();
// 创意工坊的视觉主题：恢复上次启用的色板（读不到时保持默认主题）。
void restoreVisualTheme().catch(() => {});

const GameShellPreview = lazy(() => import('./dev/GameShellPreview'));
const PlanarKitPreview = lazy(() => import('./dev/PlanarKitPreview'));
const CombatPreview = lazy(() => import('./dev/CombatPreview'));
const WorkshopPreview = lazy(() => import('./dev/WorkshopPreview'));
const MapPreview = lazy(() => import('./dev/MapPreview'));

createRoot(document.getElementById('root')!).render(
  <>
    <PlanarDefs />
    {isKitPreview() ? <Suspense fallback={null}><PlanarKitPreview /></Suspense>
      : isCombatPreview() ? <Suspense fallback={null}><CombatPreview /></Suspense>
      : isGameShellPreview() ? <Suspense fallback={null}><GameShellPreview /></Suspense>
      : isWorkshopPreview() ? <Suspense fallback={null}><WorkshopPreview /></Suspense>
      : isMapPreview() ? <Suspense fallback={null}><MapPreview /></Suspense> : <App />}
  </>,
);
