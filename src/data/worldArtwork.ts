import type { WorldArtwork, WorldDef } from './worlds-schema';

export interface WorldArtworkPreset {
  id: string;
  name: string;
  tone: string;
  src: string;
}

export interface ResolvedWorldArtwork {
  src: string;
  source: 'upload' | 'preset' | 'builtin' | 'fallback';
  focalX: number;
  focalY: number;
}

const BUILTIN_SCENES: Record<string, string> = {
  japanese_school: '/art/theme/worlds/japanese_school-scene.png',
  desire_metropolis: '/art/theme/worlds/desire_metropolis-scene.png',
  wuxia_world: '/art/theme/worlds/wuxia_world-scene.png',
  wasteland_apocalypse: '/art/theme/worlds/wasteland_apocalypse-scene.png',
  stranded_island: '/art/theme/worlds/stranded_island-scene.png',
  border_trade: '/art/theme/worlds/border_trade-scene.png',
};

export const WORLD_ARTWORK_PRESETS: WorldArtworkPreset[] = [
  { id: 'japanese_school', name: '日式校园', tone: '晨雾青蓝', src: BUILTIN_SCENES.japanese_school },
  { id: 'desire_metropolis', name: '烟火人间', tone: '暖金都会', src: BUILTIN_SCENES.desire_metropolis },
  { id: 'wuxia_world', name: '武侠世界', tone: '浅玉山水', src: BUILTIN_SCENES.wuxia_world },
  { id: 'wasteland_apocalypse', name: '末日废土', tone: '雾灰余烬', src: BUILTIN_SCENES.wasteland_apocalypse },
  { id: 'stranded_island', name: '荒岛求生', tone: '海雾浅玉', src: BUILTIN_SCENES.stranded_island },
  { id: 'border_trade', name: '边境贸易', tone: '淡金边境', src: BUILTIN_SCENES.border_trade },
];

export const NEUTRAL_WORLD_ARTWORK = '/art/theme/ui-kit/dawn-v4/backdrops/common-journey-backdrop-v1.png';

const clampFocal = (value: number | undefined, fallback: number) => (
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback
);

export function createPresetArtwork(presetId: string): WorldArtwork {
  return { source: 'preset', presetId, focalX: .5, focalY: .5 };
}

export function getDefaultArtworkPreset(world?: WorldDef | null): string {
  return WORLD_ARTWORK_PRESETS.find(preset => preset.id === world?.id)?.id
    || WORLD_ARTWORK_PRESETS[0].id;
}

export function resolveWorldArtwork(world: Pick<WorldDef, 'id' | 'artwork'>): ResolvedWorldArtwork {
  const artwork = world.artwork;
  if (artwork?.source === 'upload' && artwork.dataUrl?.startsWith('data:image/')) {
    return { src: artwork.dataUrl, source: 'upload', focalX: clampFocal(artwork.focalX, .5), focalY: clampFocal(artwork.focalY, .5) };
  }

  if (artwork?.source === 'preset' && artwork.presetId) {
    const preset = WORLD_ARTWORK_PRESETS.find(item => item.id === artwork.presetId);
    if (preset) return { src: preset.src, source: 'preset', focalX: clampFocal(artwork.focalX, .5), focalY: clampFocal(artwork.focalY, .5) };
  }

  const builtin = BUILTIN_SCENES[world.id];
  if (builtin) return { src: builtin, source: 'builtin', focalX: .5, focalY: .5 };
  return { src: NEUTRAL_WORLD_ARTWORK, source: 'fallback', focalX: .5, focalY: .5 };
}

function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] || '';
  return Math.floor((base64.length * 3) / 4);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片无法解码')); };
    image.src = url;
  });
}

export async function processWorldArtworkFile(file: File): Promise<WorldArtwork> {
  if (!file.type.startsWith('image/')) throw new Error('请选择 PNG、JPG 或 WebP 图片');

  let source: CanvasImageSource;
  let sourceWidth: number;
  let sourceHeight: number;
  let bitmap: ImageBitmap | undefined;
  try {
    if (typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(file);
      source = bitmap;
      sourceWidth = bitmap.width;
      sourceHeight = bitmap.height;
    } else {
      const image = await loadImage(file);
      source = image;
      sourceWidth = image.naturalWidth;
      sourceHeight = image.naturalHeight;
    }
  } catch {
    throw new Error('图片无法解码，请更换一张图片');
  }

  if (!sourceWidth || !sourceHeight) throw new Error('图片尺寸无效');
  const cropRatio = 3 / 4;
  const cropWidth = Math.min(sourceWidth, sourceHeight * cropRatio);
  const cropHeight = Math.min(sourceHeight, sourceWidth / cropRatio);
  const sx = (sourceWidth - cropWidth) / 2;
  const sy = (sourceHeight - cropHeight) / 2;
  const sizes = [576, 512, 448];
  const qualities = [.82, .72, .62, .52];
  let selectedDataUrl = '';

  for (const size of sizes) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = Math.round(size / cropRatio);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器不支持图片处理');
    context.drawImage(source, sx, sy, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    for (const quality of qualities) {
      const webp = canvas.toDataURL('image/webp', quality);
      const fallback = webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', quality);
      if (dataUrlBytes(fallback) <= 450 * 1024) {
        selectedDataUrl = fallback;
        break;
      }
    }
    if (selectedDataUrl) break;
  }
  bitmap?.close();
  if (!selectedDataUrl) throw new Error('图片压缩后仍过大，请选择更简单的图片');
  return { source: 'upload', dataUrl: selectedDataUrl, focalX: .5, focalY: .5 };
}
