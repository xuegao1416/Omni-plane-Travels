export type CalibrationScreen = 'hall' | 'save';
export type HallCalibrationProfile = '21x9' | '16x9' | '40x29' | '1x1' | '9x16';
export type SaveCalibrationProfile = '16x9' | '1x1' | '9x16';
export type CalibrationProfile = HallCalibrationProfile | SaveCalibrationProfile;

export interface CalibrationViewport {
  width: number;
  height: number;
  aspectRatio: number;
}

export interface CalibrationBackgroundState {
  rawOriginal: boolean;
  opacity: number;
  brightness: number;
  veilOpacity: number;
  washOpacity: number;
}

export interface CalibrationFrameState {
  frameOpacity: number;
  fillOpacity: number;
  glassOpacity: number;
  borderOpacity: number;
  centerOrnaments: {
    top: boolean;
    right: boolean;
    bottom: boolean;
    left: boolean;
  };
}

export interface CalibrationElementState {
  id: string;
  label: string;
  containerId: string;
  center: { x: number; y: number };
  offsetPx: { x: number; y: number };
  size: { width: number; height: number };
  scale: number;
  opacity: number;
  locked: boolean;
  cropBottomPct?: number;
  frame?: CalibrationFrameState;
  /** Runtime-only measurement; omitted by the exporter. */
  baselineSize: { width: number; height: number };
}

export interface CalibrationSnapshot {
  schemaVersion: 1;
  screen: CalibrationScreen;
  profile: CalibrationProfile;
  viewport: CalibrationViewport;
  background: CalibrationBackgroundState;
  elements: Record<string, CalibrationElementState>;
}

export interface ExportedCalibrationElement extends Omit<CalibrationElementState, 'baselineSize'> {}

export interface ExportedCalibrationSnapshot extends Omit<CalibrationSnapshot, 'elements'> {
  elements: Record<string, ExportedCalibrationElement>;
}

export function getCalibrationProfile(screen: CalibrationScreen, ratio: number): CalibrationProfile {
  if (screen === 'hall') {
    if (ratio >= 2) return '21x9';
    if (ratio >= 1.5) return '16x9';
    if (ratio >= 1.2) return '40x29';
    if (ratio >= .8) return '1x1';
    return '9x16';
  }

  if (ratio >= 1.5) return '16x9';
  if (ratio >= .8) return '1x1';
  return '9x16';
}

