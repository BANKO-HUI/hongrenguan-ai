# 参与贡献

感谢你帮助改进红人馆AI。

## 开始之前

- 功能建议、缺陷和交互问题请先提交 GitHub Issue。
- 不要在 Issue、日志或截图中附上 API 密钥、账号令牌、私人素材或 `.badmark` 数据。
- 提交表示你同意贡献内容按本项目的 AGPL-3.0-only 协议发布。

## 本机开发

```sh
npm ci
npm run build
npm run open
```

Node.js 版本需为 22.0 或更高。

## 提交前检查

```sh
npm test
npm run build
npm run test:e2e
```

新功能或缺陷修复需要带上对应的自动化测试。请保留用户原图、历史版本和项目状态，不要通过清空运行数据来解决问题。
