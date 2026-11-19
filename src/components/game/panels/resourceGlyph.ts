/**
 * Resource → line icon. World data stores an emoji `symbol` per resource;
 * the planar UI draws icons instead, matched on the resource id/name.
 */
import {
  Coins,Droplet,Drumstick,Fish,Flame,Gem,HeartPulse,Leaf,Mountain,Package,Pickaxe,Shirt,Sprout,TreePine,Wheat,Wrench,Zap,
  type LucideIcon,
} from 'lucide-react';

const RULES: [RegExp, LucideIcon][] = [
  [/水|water|drink/i, Droplet],
  [/肉|食物|干粮|food|meat|ration/i, Drumstick],
  [/粮|米|麦|谷|面|grain|wheat/i, Wheat],
  [/鱼|fish/i, Fish],
  [/木|柴|wood|timber|log/i, TreePine],
  [/石|岩|stone|rock/i, Mountain],
  [/矿|铁|金属|ore|metal|iron/i, Pickaxe],
  [/草药|药草|herb/i, Leaf],
  [/种子|苗|seed|sapling/i, Sprout],
  [/布|衣|纤维|cloth|fabric|fiber/i, Shirt],
  [/工具|器械|tool/i, Wrench],
  [/药|医|绷带|medic|bandage/i, HeartPulse],
  [/火|燃料|炭|fuel|fire|coal/i, Flame],
  [/电|能源|电池|power|energy|battery/i, Zap],
  [/钱|币|金|银|coin|gold|money/i, Coins],
  [/宝石|晶|gem|crystal/i, Gem],
];

export function resourceGlyph(resource: { id?: string; name?: string }): LucideIcon {
  const key = `${resource.name ?? ''} ${resource.id ?? ''}`;
  return RULES.find(([pattern]) => pattern.test(key))?.[1] ?? Package;
}
