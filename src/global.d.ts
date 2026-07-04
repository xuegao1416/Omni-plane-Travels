// CSS Module 声明（Bun 构建时处理，tsc 需要手动声明）
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}

// 副作用 CSS 导入声明
declare module '*.css';
declare module 'highlight.js/styles/*.css';
