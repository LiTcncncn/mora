# v2 云端发布数据包

由 `npm run prepare:deploy` 生成。将本目录下 **8 个 JSON 文件** 拷贝到云端 `$MORA_DATA_DIR` 即可，无需 Lab 导入。

## 文件清单

| 文件 | 说明 |
| --- | --- |
| `profiles.json` | 测试档案 |
| `settings.json` | 模型槽位、Memory、Context 等 |
| `personas.json` | MORA Persona（含 corePrompt） |
| `prompt-presets.json` | Prompt 分区模板 |
| `behavior-config.json` | v2 行为配置（Router / Energy / 策略 / 世界观 / 示例卡） |
| `conversations.json` | 空 |
| `memories.json` | 空 |
| `runs.json` | 空 |

`MANIFEST.json` 仅供核对，不必上传。

## 云端操作（停服后）

```bash
# 1. 部署代码
git pull && npm ci && npm run build

# 2. 拷贝数据包（把 /path/to/mora 换成实际路径）
cp deploy/v2-data-bundle/*.json $MORA_DATA_DIR/

# 3. 启动
npm start
```

API Key 仍在环境变量，不在 JSON 里。
