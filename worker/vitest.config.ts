import { defineConfig } from 'vitest/config';

export default defineConfig({
	// 内联空 PostCSS 配置，防止 Vite 向上查找到仓库根目录的 postcss.config.mjs
	//（CI 只安装 worker/ 依赖，根目录的 tailwindcss 不存在会导致 unhandled rejection）
	css: { postcss: { plugins: [] } },
	test: {
		include: ['test/**/*.test.ts'],
	},
});
