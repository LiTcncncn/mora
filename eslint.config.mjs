import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "data/**",
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // 本地实验台不引入数据请求库，页面数据统一用 effect 内的 fetch 加载后写入 state。
    files: ["src/components/**/*.tsx"],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
];

export default config;
