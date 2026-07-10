import { Globe, Shield, Server, Zap, ExternalLink, Check, Terminal } from 'lucide-react';
import { PROXY_CODE } from './constants';

export { PROXY_CODE };

export interface StepItem {
  text: string;
  link?: string;
  tip?: string;
  example?: string;
  code?: boolean;
}

export interface TutorialStep {
  id: string;
  title: string;
  icon: any;
  content: {
    problem?: string;
    solution?: string;
    diagram?: string;
    safety?: string;
    steps?: StepItem[];
  };
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  { id: 'intro', title: '什么是代理？为什么需要它？', icon: Globe, content: {
    problem: '浏览器有安全限制（CORS），不允许网页直接调用某些 API 服务。',
    solution: '代理就像一个"快递员"，帮你在浏览器和 API 之间传话。',
    diagram: `\n┌──────────┐      ┌──────────┐      ┌──────────┐\n│  浏览器   │ ──→  │  代理    │ ──→  │  API     │\n│ (你的网页) │ ←──  │ (中转站) │ ←──  │ (OpenAI) │\n└──────────┘      └──────────┘      └──────────┘`,
    safety: '代理只做转发，不存储任何数据\n你自己部署，完全可控\nAPI Key 不会被任何人看到',
  }},
  { id: 'register', title: '第一步：注册 Cloudflare 账号', icon: Shield, content: {
    steps: [
      { text: '打开浏览器，访问 cloudflare.com', link: 'https://cloudflare.com' },
      { text: '点击右上角的 "Sign Up"（注册）按钮' },
      { text: '输入你的邮箱和密码', tip: '建议使用常用邮箱，方便找回密码' },
      { text: '验证邮箱：去邮箱收验证邮件，点击链接完成验证', tip: '如果没收到，检查垃圾邮件文件夹' },
      { text: '注册完成！建议切换到中文界面（右上角语言设置）', tip: '中文界面更容易找到对应功能' },
    ] as StepItem[],
  }},
  { id: 'create-worker', title: '第二步：创建 Worker', icon: Server, content: {
    steps: [
      { text: '登录 Cloudflare Dashboard', link: 'https://dash.cloudflare.com' },
      { text: '在左侧菜单找到「计算」，点击展开', tip: 'Workers 和 Pages 都在「计算」菜单下面' },
      { text: '点击「Workers & Pages」进入' },
      { text: '点击右上角蓝色的「创建」按钮' },
      { text: '选择「从 Hello World 开始」', tip: '不要选 Pages！Pages 是用来托管网站的' },
      { text: '给你的 Worker 起个名字', tip: '比如：api-proxy、my-proxy、cors-helper 等\n名字会成为 URL 的一部分', example: 'https://api-proxy.你的用户名.workers.dev' },
      { text: '点击「部署」按钮，先创建一个默认的 Worker', tip: '别担心，我们马上会替换里面的代码' },
      { text: '如果看到红色报错，不用管！直接刷新页面', tip: '这是正常现象，刷新后就能正常操作了' },
    ] as StepItem[],
  }},
  { id: 'paste-code', title: '第三步：粘贴代理代码', icon: Zap, content: {
    steps: [
      { text: '刷新页面后，点击「编辑代码」按钮' },
      { text: '你会看到一个代码编辑器，里面有一些默认代码' },
      { text: '全选所有代码（Ctrl+A），然后删除' },
      { text: '复制下面的代理代码，粘贴进去', code: true },
      { text: '点击右上角的「部署」按钮', tip: '代码会自动保存并部署' },
      { text: '部署成功后，回到「Workers & Pages」页面' },
    ] as StepItem[],
  }},
  { id: 'get-url', title: '第四步：获取你的代理地址', icon: ExternalLink, content: {
    steps: [
      { text: '回到「Workers & Pages」页面' },
      { text: '找到你刚才创建的 Worker' },
      { text: '在详情页找到「URL」或「路由」', tip: '格式类似：https://api-proxy.xxx.workers.dev' },
      { text: '点击复制按钮，复制这个 URL', tip: '这就是你的专属代理地址！' },
    ] as StepItem[],
  }},
  { id: 'use', title: '第五步：在应用中使用', icon: Check, content: {
    steps: [
      { text: '回到这个应用的设置页面' },
      { text: '找到「代理地址」输入框' },
      { text: '粘贴你刚才复制的 Worker URL' },
      { text: '点击「测试连接」验证是否正常工作', tip: '如果显示「连接成功」就说明代理工作正常！' },
      { text: '保存设置，大功告成！', tip: '以后遇到 CORS 错误，应用会自动使用代理' },
    ] as StepItem[],
  }},
  { id: 'logs', title: '查看日志（遇到问题时）', icon: Terminal, content: {
    steps: [
      { text: '如果代理不工作，可以查看浏览器控制台日志来排查问题' },
      { text: '按 F12 打开浏览器开发者工具', tip: 'Chrome/Edge: F12 或 Ctrl+Shift+I\n也可以右键页面 → 检查' },
      { text: '点击顶部的「Console」（控制台）选项卡' },
      { text: '找到带 [Proxy] 标记的日志', tip: '紫色标题的折叠区域就是代理日志\n展开可以看到完整的请求路由信息' },
      { text: '日志会显示：代理地址是否正确、是否使用了代理、请求是否成功', tip: '✓ 绿色 = 正常\n✗ 红色 = 有问题，展开看具体原因' },
      { text: '把红色错误的日志截图发给开发者即可', tip: '重点看：代理地址、目标 API、错误信息这三项' },
    ] as StepItem[],
  }},
];

