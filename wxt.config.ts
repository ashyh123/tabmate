import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  // 默认是仓库根目录下的 public/；放进 src/ 使扩展的全部内容都在 src/ 下。
  publicDir: 'src/public',
  modules: ['@wxt-dev/module-react'],
  // 关闭自动导入：所有引用都写成显式 import，依赖规则检查（scripts/ci/check-deps.mjs）才能看到全部依赖。
  imports: false,
  manifest: {
    name: 'tabmate',
    description: '一个为个人使用而设计、易于扩展的浏览器插件',
    permissions: ['storage', 'scripting'],
    host_permissions: ['<all_urls>'],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
