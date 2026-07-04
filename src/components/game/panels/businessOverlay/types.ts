import type { BusinessModuleSchema } from '../../../../modules/schema';

export interface BusinessOverlayProps {
  open: boolean;
  data: BusinessModuleSchema;
  title?: string;
  onClose: () => void;
}
