export interface CreationStepLayout {
  labels: string[];
  professionStep: number;
  loadoutStep: number;
  historyStep: number;
  confirmStep: number;
}

export function getCreationStepLayout(hasProfession: boolean): CreationStepLayout {
  return hasProfession ? {
    labels: ['降临身份', '职业与先天天赋', '行囊与同行者', '前尘编年', '启程契约'],
    professionStep: 2,
    loadoutStep: 3,
    historyStep: 4,
    confirmStep: 5,
  } : {
    labels: ['降临身份', '行囊与同行者', '前尘编年', '启程契约'],
    professionStep: -1,
    loadoutStep: 2,
    historyStep: 3,
    confirmStep: 4,
  };
}
