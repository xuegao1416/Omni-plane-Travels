import type { BusinessModuleSchema } from '../../../../modules/schema';

export interface BusinessOverlayProps {
  open: boolean;
  data: BusinessModuleSchema;
  config?: BusinessModuleSchema;
  title?: string;
  onPurchase?: (assetId: string) => void;
  onUpgrade?: (assetId: string) => void;
  onAssignStaff?: (assetId: string, count: number, efficiency?: number) => void;
  onClose: () => void;
}
