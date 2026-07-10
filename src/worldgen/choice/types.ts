// 选择式世界生成管线 — 类型定义
// ============================================================

/** 单个维度的选项 */
export interface DimensionChoice {
  id: string;           // 'A' | 'B' | 'C' | 'D' | 'E'(自定义)
  title: string;        // "严肃古典仙侠"
  subtitle: string;     // "以武为尊，宗门林立"
  isCustom?: boolean;   // 是否为用户自定义选项
}

/** 单个维度的生成结果 */
export interface DimensionGeneration {
  narrative: string;    // AI生成的描述文字
  choices: DimensionChoice[];  // 4个选项
}

/** 用户在某个维度的选择 */
export interface DimensionSelection {
  dimensionKey: string;
  dimensionLabel: string;
  choiceId: string;
  choice: DimensionChoice;
  /** 多选时的所有选择ID（逗号分隔） */
  choiceIds?: string;
  /** 多选时的所有选择 */
  choices?: DimensionChoice[];
}
