import { describe, expect, test } from 'bun:test';
import {
  getBuiltinPreset,
  getEnabledPrompts,
} from './builtinPresets';
import { DRC_FORMAT_REPAIR_PROMPT_ID } from './presetDrcV12';
import { MacroEngine } from '../engine/macroEngine';
import { assembleSystemPrompt, injectAtDepthEntries } from '../engine/promptAssembler';

describe('DeepSeek built-in preset', () => {
  const preset = getBuiltinPreset('deepseek');
  const byId = (identifier: string) => preset.prompts.find(prompt => prompt.identifier === identifier);

  test('does not ask DeepSeek to emit a second visible reasoning pass', () => {
    expect(byId('thinking')?.enabled).toBe(false);
    expect(byId('writing_process')?.enabled).toBe(false);
    expect(byId('integrity_statement')?.enabled).toBe(false);
  });

  test('uses a concise DeepSeek output contract with options before the final marker', () => {
    const outputFormat = byId('output_format')?.content ?? '';

    expect(outputFormat).not.toContain('<thinking>');
    expect(outputFormat).toContain('600-1000');
    expect(outputFormat.indexOf('[OPTION_START]')).toBeGreaterThan(outputFormat.indexOf('<contenttext>'));
    expect(outputFormat).toContain('[OPTION_END]');
  });

  test('keeps the DRC format repair switch off by default', () => {
    const repair = getBuiltinPreset('drc_v12').prompts.find(
      prompt => prompt.identifier === DRC_FORMAT_REPAIR_PROMPT_ID,
    );

    expect(repair?.enabled).toBe(false);
  });

  test('contains balanced writing-style tags and no Claude-only compatibility text', () => {
    const enabledText = getEnabledPrompts(preset).map(prompt => prompt.content).join('\n');
    const openingTags = enabledText.match(/<WritingStyle>/g) ?? [];
    const closingTags = enabledText.match(/<\/WritingStyle>/g) ?? [];

    expect(openingTags).toHaveLength(closingTags.length);
    expect(enabledText).not.toContain('Claude 4.8');
    expect(enabledText).not.toContain('Constitutional AI');
  });

  test('keeps the DeepSeek task short and avoids adversarial model-specific baggage', () => {
    const task = byId('task')?.content ?? '';

    expect(task.length).toBeLessThan(1_200);
    expect(task).toContain('虚构创作');
    expect(task).not.toContain('DeepSeek 倾向');
    expect(task).not.toContain('未成年');
    expect(task).not.toContain('不受现实法律法规');
  });

  test('automatically applies the compact intimacy rules without a manual mode switch', () => {
    const nsfw = byId('nsfw_content')?.content ?? '';

    expect(nsfw.length).toBeLessThan(1_200);
    expect(nsfw).toContain('无需用户手动开启');
    expect(nsfw).toContain('用户明确要求');
    expect(nsfw).toContain('上下文已经进入');
  });

  test('disables redundant anti-style modules in the DeepSeek preset', () => {
    const redundantIds = [
      'anti_metaphor',
      'anti_reveal',
      'anti_voice_desc',
      'anti_synesthesia',
      'anti_shaguanlian',
      'anti_micro_macro',
    ];

    for (const identifier of redundantIds) {
      expect(byId(identifier)?.enabled).toBe(false);
    }
  });

  test('uses one compact final completion lock and keeps the enabled prompt lean', () => {
    const outputFormat = byId('output_format')?.content ?? '';
    const enabledText = getEnabledPrompts(preset).map(prompt => prompt.content).join('\n\n');

    expect(outputFormat.length).toBeLessThan(800);
    expect(outputFormat).toContain('只有输出 [OPTION_END] 后才算完成');
    expect(outputFormat).toContain('空间不足时立即缩短正文');
    expect(enabledText.length).toBeLessThan(8_000);
  });
});

describe('文风切换（setvar 单选机制）', () => {
  const STYLE_IDS = [
    'style_light_novel',
    'style_banter',
    'style_campus',
    'style_baimiao',
    'style_wuxia',
    'style_prose',
    'style_freeform',
  ];

  const resolveEnabled = (presetId: string, enableIds: string[] = []) => {
    const preset = getBuiltinPreset(presetId);
    const prompts = preset.prompts.map(p =>
      enableIds.includes(p.identifier) ? { ...p, enabled: true } : p,
    );
    const joined = getEnabledPrompts({ ...preset, prompts })
      .map(p => p.content)
      .join('\n\n');
    return new MacroEngine().resolve(joined);
  };

  test('四个自研预设都带 7 个文风切换条目，默认全部关闭', () => {
    expect(STYLE_IDS).toHaveLength(7);
    for (const presetId of ['default', 'claude', 'deepseek', 'dialogue_avatar']) {
      const preset = getBuiltinPreset(presetId);
      for (const styleId of STYLE_IDS) {
        const entry = preset.prompts.find(p => p.identifier === styleId);
        expect(entry).toBeDefined();
        expect(entry?.enabled).toBe(false);
        expect(entry?.content).toContain('{{setvar::base_writing::');
      }
      // 注入插槽默认开启
      expect(preset.prompts.find(p => p.identifier === 'writing_style_slot')?.enabled).toBe(true);
      // 默认文风条目仍开启，且同样走 setvar 包装
      const ws = preset.prompts.find(p => p.identifier === 'writing_style');
      expect(ws?.enabled).toBe(true);
      expect(ws?.content).toContain('{{setvar::base_writing::');
    }
  });

  test('默认渲染只含默认文风，不混入可选文风', () => {
    const resolved = resolveEnabled('default');
    expect(resolved).toContain('整体基调轻松明亮'); // 默认文风
    for (const marker of [
      '文风：日系轻小说',
      '文风：轻松吐槽',
      '文风：校园青春',
      '文风：白描',
      '文风：古风武侠',
      '文风：散文小说',
      '文风：自由随性',
    ]) {
      expect(resolved).not.toContain(marker);
    }
    // 宏应被全部消费，不残留
    expect(resolved).not.toContain('{{setvar::');
    expect(resolved).not.toContain('{{getvar::');
  });

  test('开启一个文风即整体覆盖默认文风', () => {
    const resolved = resolveEnabled('default', ['style_campus']);
    expect(resolved).toContain('文风：校园青春');
    expect(resolved).not.toContain('整体基调轻松明亮');
  });

  test('同时开启多个文风时，仅 order 最大者生效（单选）', () => {
    const resolved = resolveEnabled('default', ['style_wuxia', 'style_campus']);
    expect(resolved).toContain('文风：古风武侠');
    expect(resolved).not.toContain('文风：校园青春');
  });

  test('DeepSeek 预设的文风切换同样生效（替换其专用默认文风）', () => {
    const resolved = resolveEnabled('deepseek', ['style_wuxia']);
    expect(resolved).toContain('文风：古风武侠');
    expect(resolved).not.toContain('语言自然、直接、连贯'); // DeepSeek 默认文风被覆盖
  });
});

describe('实验性破甲·尾部深度注入（默认预设）', () => {
  const preset = getBuiltinPreset('default');
  const byId = (identifier: string) => preset.prompts.find(p => p.identifier === identifier);

  const assemble = (enableIds: string[], userText: string) => {
    const prompts = preset.prompts.map(p =>
      p.identifier === 'exp_tail_reinforce' || p.identifier === 'exp_tail_sensitive'
        ? { ...p, enabled: enableIds.includes(p.identifier) }
        : p,
    );
    return assembleSystemPrompt({ ...preset, prompts }, {
      varSnapshot: '',
      wbInjection: '',
      playerProfileBlock: '',
      firewallTitle: '',
      firewallContent: '',
      userText,
      round: 1,
      macroEngine: new MacroEngine(),
    });
  };

  test('两个 Gemini 尾部兼容开关都默认开启', () => {
    expect(byId('exp_tail_reinforce')?.enabled).toBe(true);
    expect(byId('exp_tail_sensitive')?.enabled).toBe(true);
  });

  test('Gemini 3.8 默认不要求输出思维链或创作流程', () => {
    expect(byId('thinking')?.enabled).toBe(false);
    expect(byId('writing_process')?.enabled).toBe(false);
  });

  test('不启用时不产生任何深度注入，系统提示保持原样', () => {
    expect(assemble([], '我走进酒馆').depthEntries).toHaveLength(0);
    expect(assemble([], '我走进酒馆').systemPrompt).not.toContain('TailReinforce');
  });

  test('启用后条目离开系统提示头部，改挂到聊天历史末尾（紧邻生成点）', () => {
    const result = assemble(['exp_tail_reinforce'], '我走近她');

    expect(result.systemPrompt).not.toContain('TailReinforce');
    expect(result.depthEntries).toHaveLength(1);
    expect(result.depthEntries[0].depth).toBe(0);
    expect(result.depthEntries[0].label).toBe('创作重申');

    const history = injectAtDepthEntries(
      [
        { role: 'assistant' as const, content: '旧回复' },
        { role: 'user' as const, content: '当前玩家输入' },
      ],
      result.depthEntries,
    );
    expect(history).toHaveLength(3);
    expect(history[history.length - 2].content).toBe('当前玩家输入');
    expect(history[history.length - 1].content).toMatch(/^\[创作重申 - depth:0\]/);
    expect(history[history.length - 1].content).toContain('<TailReinforce>');
  });

  test('敏感触发档只在玩家输入命中关键词时注入', () => {
    expect(assemble(['exp_tail_sensitive'], '我们聊了聊天气').depthEntries).toHaveLength(0);
    expect(assemble(['exp_tail_sensitive'], '她吻了我').depthEntries).toHaveLength(1);
  });
});

describe('双人成行（适配版）Gemini 尾部兼容', () => {
  const preset = getBuiltinPreset('drc_v12');

  test('默认把创作重申放在历史尾部而不是系统提示头部', () => {
    const tail = preset.prompts.find(p => p.identifier === 'drc_gemini_tail_reinforce');
    expect(tail).toMatchObject({ enabled: true, injectionPosition: 1, injectionDepth: 0 });

    const result = assembleSystemPrompt(preset, {
      varSnapshot: '',
      wbInjection: '',
      playerProfileBlock: '',
      firewallTitle: '',
      firewallContent: '',
      userText: '两位成年角色继续亲密互动',
      round: 1,
      macroEngine: new MacroEngine(),
    });
    expect(result.systemPrompt).not.toContain('<TailReinforce>');
    expect(result.depthEntries.some(entry => entry.depth === 0 && entry.content.includes('<TailReinforce>'))).toBe(true);
  });
});
