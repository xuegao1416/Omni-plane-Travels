/** 根据角色年龄动态计算人生阶段 */
export function getAgeStages(ageStr: string): { id: string; label: string }[] {
  const age = parseInt(String(ageStr), 10);
  const STAGE_COUNT = 4;

  // 年龄无效或太小，给默认4段
  if (!age || age < 1) {
    return [
      { id: 'stage_0', label: '幼年' },
      { id: 'stage_1', label: '童年' },
      { id: 'stage_2', label: '少年' },
      { id: 'stage_3', label: '青年' },
    ];
  }

  // 年龄太小不足以分4段
  if (age <= STAGE_COUNT) {
    const stages: { id: string; label: string }[] = [];
    for (let i = 0; i < age; i++) {
      stages.push({ id: `stage_${i}`, label: `${i}岁` });
    }
    return stages;
  }

  const base = Math.floor(age / STAGE_COUNT);
  let remainder = age % STAGE_COUNT;
  const boundaries: number[] = [0];
  let current = 0;

  for (let i = 0; i < STAGE_COUNT; i++) {
    current += base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
    boundaries.push(Math.min(current, age));
  }

  const stages: { id: string; label: string }[] = [];
  for (let i = 0; i < STAGE_COUNT; i++) {
    const from = boundaries[i];
    const to = boundaries[i + 1] - (i < STAGE_COUNT - 1 ? 1 : 0);
    const effectiveTo = i === STAGE_COUNT - 1 ? age - 1 : to;
    stages.push({
      id: `stage_${i}`,
      label: `${from}~${effectiveTo}岁`,
    });
  }
  return stages;
}

/** 获取所有段落ID（序章 + 动态阶段） */
export function getAllSegmentIds(ageStr: string): string[] {
  return ['prologue', ...getAgeStages(ageStr).map(s => s.id)];
}
