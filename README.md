# Claude Code 超时邮件提醒 Hook

## 必要前提
必须在 Claude Code 中配置 Hook，脚本才会被调用。项目级配置位置：`.claude/settings.json`。

## 配置文件示例（必须存在）
`.claude/settings.json` 中应包含以下 Hook 配置（本项目已提供）：

```
{
  "hooks": [
    {
      "event": "Notification",
      "matcher": "idle_prompt",
      "command": "node .claude/.hooks/email-reminder.js start"
    },
    {
      "event": "UserPromptSubmit",
      "command": "node .claude/.hooks/email-reminder.js clear"
    }
  ]
}
```

## 用途
当 Claude Code 需要你输入（`idle_prompt` 通知）且 5 分钟内未收到回复时，自动发送邮件提醒你。

## 快速开始
1. 确认 `.claude/settings.json` 已配置 Hook（见上方示例）。
2. 复制配置模板：
   - 将 `.claude/.hooks/email.config.local.example.json` 复制为 `.claude/.hooks/email.config.local.json`。
3. 填入 SMTP 发件信息与收件人邮箱。
4. 运行 Claude Code，Hook 将自动生效。

## 配置说明
- `smtp.host`：SMTP 主机地址。
- `smtp.port`：端口，默认 465。
- `smtp.secure`：是否使用 SSL，默认 true。
- `smtp.user`：发件邮箱账号。
- `smtp.pass`：邮箱安全码或授权码。
- `from`：发件人显示名称与邮箱。
- `to`：收件人列表。
- `subject`：邮件主题（可选）。
- `timeoutSeconds`：超时秒数（默认 300）。

## 行为规则
- 每次 `idle_prompt` 触发只提醒一次。
- 若 5 分钟内用户提交了回复，提醒会被取消。

## 常见问题
- 未收到邮件：请检查 SMTP 主机、端口、授权码是否正确，并确保网络可访问 SMTP 服务。

无迁移，直接替换。
