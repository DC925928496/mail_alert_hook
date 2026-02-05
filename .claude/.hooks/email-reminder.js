'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const nodemailer = require('nodemailer');

const HOOKS_DIR = __dirname;
const DEFAULT_CONFIG_PATH = path.join(HOOKS_DIR, 'email.config.local.json');
const DEFAULT_STATE_PATH = path.join(HOOKS_DIR, 'email-reminder.state.json');
const DEFAULT_TIMEOUT_SECONDS = 300;

function nowIso() {
  return new Date().toISOString();
}

function readJsonIfExists(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) {
      return fallback;
    }
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  const content = JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, content, 'utf8');
}

function readHookInput() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw.trim()) {
      return {};
    }
    return JSON.parse(raw);
  } catch (error) {
    return {};
  }
}

function extractNotification(input) {
  const notification = input.notification || {};
  return {
    type: notification.type || input.type || null,
    title: notification.title || input.title || null,
    message: notification.message || input.message || null,
    sessionId: input.session_id || input.sessionId || notification.session_id || null
  };
}

function createToken() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

function loadConfig(configPath) {
  const config = readJsonIfExists(configPath, null);
  if (!config) {
    throw new Error(`未找到配置文件：${configPath}`);
  }
  if (!config.smtp || !config.smtp.host || !config.smtp.user || !config.smtp.pass) {
    throw new Error('配置缺少 smtp.host / smtp.user / smtp.pass');
  }
  if (!config.from || !config.from.email) {
    throw new Error('配置缺少 from.email');
  }
  if (!config.to || (Array.isArray(config.to) && config.to.length === 0)) {
    throw new Error('配置缺少 to');
  }
  return config;
}

function normalizeRecipients(toField) {
  if (Array.isArray(toField)) {
    return toField.join(', ');
  }
  return toField;
}

function buildEmail(config, state, now) {
  const subject = config.subject || 'Claude Code 等待输入提醒';
  const projectPath = path.resolve(process.cwd());
  const lines = [
    '你在 Claude Code 中有一条等待输入的提示，已超过 5 分钟未回复。',
    `项目路径：${projectPath}`,
    `触发时间：${state.createdAt || now}`,
    state.title ? `提示标题：${state.title}` : null,
    state.message ? `提示内容：${state.message}` : null
  ].filter(Boolean);

  return {
    from: config.from.name ? `${config.from.name} <${config.from.email}>` : config.from.email,
    to: normalizeRecipients(config.to),
    subject,
    text: lines.join('\n')
  };
}

function createSmtpTransport(config) {
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port || 465,
    secure: config.smtp.secure !== false,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass
    }
  });
}

async function sendEmail({ config, state, transport, now }) {
  const message = buildEmail(config, state, now);
  const mailTransport = transport || createSmtpTransport(config);
  return mailTransport.sendMail(message);
}

function getTimeoutSeconds(config) {
  const override = process.env.EMAIL_REMINDER_TIMEOUT_OVERRIDE_SEC;
  if (override) {
    const parsed = Number(override);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  if (typeof config.timeoutSeconds === 'number') {
    return config.timeoutSeconds;
  }
  return DEFAULT_TIMEOUT_SECONDS;
}

function readState(statePath) {
  return readJsonIfExists(statePath, null);
}

function writeState(statePath, state) {
  writeJson(statePath, state);
}

function clearState(statePath) {
  if (!fs.existsSync(statePath)) {
    return false;
  }
  const state = readState(statePath);
  if (!state) {
    return false;
  }
  state.clearedAt = nowIso();
  writeState(statePath, state);
  return true;
}

function startReminder({ configPath, statePath }) {
  const input = readHookInput();
  const notification = extractNotification(input);
  const token = createToken();
  const state = {
    token,
    createdAt: nowIso(),
    sessionId: notification.sessionId,
    notificationType: notification.type,
    title: notification.title,
    message: notification.message
  };
  writeState(statePath, state);

  const child = spawn(process.execPath, [__filename, 'check', token], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
}

function clearReminder({ statePath }) {
  clearState(statePath);
}

async function checkAndSendNow({ token, configPath, statePath, now, transport }) {
  const state = readState(statePath);
  if (!state || state.token !== token) {
    return { skipped: true, reason: 'state-missing-or-token-mismatch' };
  }
  if (state.clearedAt) {
    return { skipped: true, reason: 'state-cleared' };
  }
  if (state.sentAt) {
    return { skipped: true, reason: 'already-sent' };
  }

  const config = loadConfig(configPath);
  await sendEmail({ config, state, transport, now });
  state.sentAt = now;
  writeState(statePath, state);
  return { sent: true };
}

function scheduleCheck({ token, configPath, statePath }) {
  const config = loadConfig(configPath);
  const timeoutSeconds = getTimeoutSeconds(config);
  setTimeout(async () => {
    try {
      await checkAndSendNow({
        token,
        configPath,
        statePath,
        now: nowIso()
      });
    } catch (error) {
      // 仅记录错误，不影响 Claude Code 的 Hook 流程
      const errorState = readState(statePath) || { token };
      errorState.errorAt = nowIso();
      errorState.errorMessage = error.message;
      writeState(statePath, errorState);
    }
  }, Math.max(0, timeoutSeconds * 1000));
}

function printUsage() {
  process.stdout.write('用法: node email-reminder.js <start|clear|check> [token]\n');
}

if (require.main === module) {
  const [command, token] = process.argv.slice(2);
  const configPath = DEFAULT_CONFIG_PATH;
  const statePath = DEFAULT_STATE_PATH;

  if (command === 'start') {
    startReminder({ configPath, statePath });
    process.exit(0);
  }

  if (command === 'clear') {
    clearReminder({ statePath });
    process.exit(0);
  }

  if (command === 'check') {
    if (!token) {
      printUsage();
      process.exit(1);
    }
    scheduleCheck({ token, configPath, statePath });
    return;
  }

  printUsage();
  process.exit(1);
}

module.exports = {
  buildEmail,
  checkAndSendNow,
  clearState,
  createSmtpTransport,
  extractNotification,
  getTimeoutSeconds,
  loadConfig,
  readState,
  readJsonIfExists,
  startReminder,
  writeState
};
