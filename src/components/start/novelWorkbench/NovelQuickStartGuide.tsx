import { useState } from 'react';
import type { NovelAnalysisGoal } from '../../../novel/types';

type Step = { title: string; where: string; actions: string[]; done: string; image: string; extraImage?: string; tab?: number };
const IMPORT: Step = { title: '上传你想玩的小说', where: '小说拆解台顶部 →「01 · 来源与章节」', actions: ['点中间的「选择或拖入小说文件」，选你的 TXT 或 EPUB。', '上传后往下滑，看看正文能不能正常读。没有乱码就继续。'], done: '页面出现章节数量和正文预览。', image: '01-import.png', tab: 0 };
const API: Step = { title: '让拆解台连上你的 AI', where: '顶部 →「02 · 分析任务」→ 展开「拆解预设、专用 API 与检索配置」', actions: ['已有游戏 AI：往下滑，点「复制游戏 API 配置」。没有配置过：填服务商给你的接口地址、密钥和模型。', '往下滑，先点「测试生成连接」，通过后点「保存专用配置」。其他设置先不改。'], done: '页面提示「拆解专用配置已保存」。截图参数是示意，不能照抄。', image: '02-api.png', extraImage: '02-save-api.png', tab: 1 };
const MATERIAL: Step = { title: '确认小说人物和设定已经读出来', where: '顶部 →「03 · 世界资料」', actions: ['看这里是否已经出现人物、地点、规则等文字。', '有资料就继续。没资料就回「02 · 分析任务」看进度或报错，先不要重新上传。'], done: '页面显示「世界资料 · …条」，下面有实际内容。', image: '04-material.png', tab: 2 };
const GAME_API: Step = { title: '如果跳到设置页，补好游戏 AI', where: '设置页左侧 →「API 设置」', actions: ['拆小说的 AI 和游戏聊天的 AI 要分别配置。跳到这里时，刚才的旅程已经保存。', '填你的接口地址、密钥和模型，往下滑测试连接，再点「保存配置」。', '回到游戏，在输入框发送：我环顾四周，先确认自己在哪里。已经配置游戏 AI 的玩家跳过这一步。'], done: '进入游戏，可以在输入框发送自己的行动。', image: '11-game-api.png', extraImage: '11-save-game-api.png' };

export const NOVEL_QUICK_START_STEPS: Record<NovelAnalysisGoal, Step[]> = {
  background: [IMPORT, API,
    { title: '让 AI 读取小说的人物和设定', where: '顶部 →「02 · 分析任务」', actions: ['选择「在小说世界里自由玩 · 先读人物和设定」。', '点右下角「读取人物和世界设定」，然后等它处理。', '想暂时退出就点「保存并关闭」；回来在第一页选「继续已有资料」。'], done: '看到世界资料已保存的提示，或者「03 · 世界资料」里已有内容。', image: '03-analysis.png', tab: 1 }, MATERIAL,
    { title: '把这些小说资料变成可玩的世界', where: '顶部 →「05 · 创建世界」', actions: ['先点教程里的「把教程单独打开」，保留后面的开局指导。创建后拆解台会关闭。', '保持「在小说世界里自由玩」，世界名称可以直接用默认值。', '点绿色按钮「创建世界，开始自己的故事」。'], done: '拆解台关闭，回到世界大厅。', image: '05-background.png', tab: 4 },
    { title: '在大厅打开刚才创建的世界', where: '世界大厅 → 点击名字带「背景世界」的晶体', actions: ['创建后一般自动翻到你的世界。没看到就用大厅底部箭头翻页。', '点自己的世界晶体，弹出详情后点右下角「选择并继续」。'], done: '进入「世界降临仪式」，第一步是「降临身份」。', image: '08-hall-free.png' },
    { title: '写好自己的角色身份', where: '世界降临仪式 →「降临身份」', actions: ['填姓名、年龄，点选性别。想扮演书里的某个人，可以直接填他的姓名、性格和背景。', '点右下角「下一步」。行囊没想好可以不填，再点「下一步」。'], done: '到「前尘编年」页面。', image: '09-identity-free.png' },
    { title: '跳过经历，正式开始冒险', where: '「前尘编年」→「启程契约」', actions: ['不想写以前的经历，就点右下角「跳过经历」。', '下一页点右下角「开始冒险」，给存档取名，再点弹窗里的「开始冒险」。'], done: '旅程已创建。已配游戏 AI 时进入游戏；没有配置时进入设置页，继续下一步。', image: '10-start-free.png' }, GAME_API,
  ],
  full: [IMPORT, API,
    { title: '让 AI 连原作故事一起读', where: '顶部 →「02 · 分析任务」', actions: ['选择「扮演书中人物，按原作故事开局 · 连剧情一起读」。', '点右下角「读取小说设定和原作故事」，然后等它处理。'], done: '「03 · 世界资料」有内容；「04 · 剧情资料」里所需故事段显示完成。', image: '03-analysis-original.png', tab: 1 }, MATERIAL,
    { title: '把已读出的故事整理成开局剧情', where: '顶部 →「05 · 创建世界」→ 选「扮演书中人物，按原作故事开局」', actions: ['向下滑到「主线剧情」。现在它直接显示，已经不藏在折叠里。', '点「整理本世界小说剧情」，等整理完成。不用自己再写剧情。'], done: '下面出现「AI 已整理出可用剧情」和「保存剧情版本并选用」按钮。', image: '06-director.png', tab: 4 },
    { title: '保存刚才整理好的剧情', where: '还是「05 · 创建世界」→ 往下看到「AI 已整理出可用剧情」', actions: ['默认起始阶段可以直接用默认值。想换故事起点，再从下拉框选择。', '直接点「保存剧情版本并选用」。不用填写一大堆剧情字段；查看或修改细节是可选的。'], done: '看到「剧情版本已保存，保存世界后用于新开局」。', image: '07-save-director.png', tab: 4 },
    { title: '创建带原作故事的世界', where: '点顶部「05 · 创建世界」回到本页顶部，再往下看到绿色按钮', actions: ['先点教程里的「把教程单独打开」，保留后面的开局指导。创建后拆解台会关闭。', '如果起始故事段还没完成，先回「02 · 分析任务」继续读取；想换起点就在「世界起始剧情段」选择已完成的段。', '点绿色按钮「创建世界，选择书中人物开局」。'], done: '拆解台关闭，回到世界大厅。', image: '07-create-original.png', tab: 4 },
    { title: '在大厅打开这个小说世界', where: '世界大厅 → 点击名字带「小说世界」的晶体', actions: ['没看到自己的世界，就用大厅底部箭头翻页。', '点世界晶体，弹出详情后点右下角「选择并继续」。'], done: '进入「世界降临仪式」。', image: '08-hall.png' },
    { title: '选择你想成为的书中人物', where: '「降临身份」→ 页面里的「主线身份与起点」', actions: ['在「扮演身份」下拉框选人物；在「剧情起点」选从哪一段开始。', '补上年龄，点选性别，再点右下角「下一步」。行囊不需要时留空，继续点「下一步」。'], done: '到「前尘编年」页面。', image: '09-role.png' },
    { title: '开始自己的这一次原作旅程', where: '「前尘编年」→「启程契约」', actions: ['没想好以前的经历就点「跳过经历」。', '下一页点右下角「开始冒险」，给存档取名，再点弹窗里的「开始冒险」。'], done: '旅程已创建。没配游戏 AI 时会跳到设置，继续下一步。', image: '10-start.png' }, GAME_API,
  ],
};

export function NovelQuickStartGuide({ onGoToTab, onChooseGoal }: { onGoToTab: (tab: number, goal: NovelAnalysisGoal) => void; onChooseGoal: (goal: NovelAnalysisGoal) => void }) {
  const [goal, setGoal] = useState<NovelAnalysisGoal>('background');
  const [step, setStep] = useState(0);
  const steps = NOVEL_QUICK_START_STEPS[goal], current = steps[step];
  const choose = (next: NovelAnalysisGoal) => { setGoal(next); setStep(0); onChooseGoal(next); };
  return <section className="novel-quick-guide" aria-label="小说拆解台一步一步教程">
    <h3>你想怎么玩？</h3>
    <div className="novel-quick-guide__routes" role="group" aria-label="想玩的内容">
      <button type="button" aria-pressed={goal === 'background'} onClick={() => choose('background')}>在小说世界里自由玩</button>
      <button type="button" aria-pressed={goal === 'full'} onClick={() => choose('full')}>扮演书中人物，按原作故事开局</button>
    </div>
    <p>{goal === 'background' ? '用书里的人物、地点和规则，开始自己的故事。跟着下面点，不用整理原作剧情。' : '选书里的一个人物，从原作的某段故事开始玩。跟着下面点，AI 整理剧情，不用你自己写。'}</p>
    <div className="novel-quick-guide__navigation"><button type="button" disabled={step === 0} onClick={() => setStep(step - 1)}>上一步</button><strong>第 {step + 1} / {steps.length} 步</strong><button type="button" disabled={step === steps.length - 1} onClick={() => setStep(step + 1)}>我做完了，下一步</button></div>
    <article aria-live="polite">
      <h4>现在只做这件事：{current.title}</h4>
      <p className="novel-quick-guide__where"><b>在哪里：</b>{current.where}</p>
      <ol>{current.actions.map(action => <li key={action}>{action}</li>)}</ol>
      <p className="novel-quick-guide__done"><b>做到这样就成功：</b>{current.done}</p>
      <a href={`/tutorial/novel/index.html?play=${goal}&step=${step + 1}`} target="_blank" rel="noopener noreferrer">把教程单独打开</a><p className="novel-import-workbench__hint">创建世界后拆解台会关闭。单独打开的教程可以继续指导你选世界、填角色、开始冒险。</p>
      {current.tab !== undefined && <button type="button" onClick={() => onGoToTab(current.tab!, goal)}>带我打开这个页面</button>}
      <p className="novel-import-workbench__hint">图上红色编号贴着要点的控件，右边同一编号说明操作。可打开原图放大。小说成果和接口参数均为教学示例。</p>
      <img src={`/tutorial/novel/${current.image}`} alt={`${current.title}，操作位置见红色编号`} loading="lazy" />
      <a href={`/tutorial/novel/${current.image}`} target="_blank" rel="noopener noreferrer">放大这张图</a>
      {current.extraImage && <><p>向下滚动后的按钮位置：</p><img src={`/tutorial/novel/${current.extraImage}`} alt="向下滚动，找到测试和保存按钮" loading="lazy" /><a href={`/tutorial/novel/${current.extraImage}`} target="_blank" rel="noopener noreferrer">放大下一张图</a></>}
    </article>
    <button type="button" disabled={step === steps.length - 1} onClick={() => setStep(step + 1)}>我做完了，下一步</button>
    <details><summary>按钮点不了，或拆到一半怎么办？</summary><p>看操作页面顶部的提示，它会告诉你还缺上传、AI 配置、世界资料、已完成的故事段，还是剧情保存。处理完缺少的这一项再继续。</p><p>AI 读取和聊天会产生费用。想停下来就点「暂停」或「保存并关闭」。换设备前点「备份原文与付费成果」，换设备后导入备份 JSON。</p></details>
  </section>;
}
