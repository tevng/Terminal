const { accessSync, constants, statSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dimensions } = require('./ssh.cjs');
const { english } = require('../i18n/index.cjs');

const windows = process.platform === 'win32';

function executable(file) {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function shellCommand(shell, t) {
  if (shell !== 'bash' && shell !== 'zsh') throw Error(t('local.invalidShell'));

  if (windows) {
    const file = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
    if (!executable(file)) throw Error(t('local.missingWsl'));
    return { file, args: ['--cd', '~', '--exec', shell, '-i'] };
  }

  const directories = (process.env.PATH || '/usr/bin:/bin').split(path.delimiter);
  const file = directories.filter(directory => path.isAbsolute(directory))
    .map(directory => path.join(directory, shell)).find(executable);
  if (!file) throw Error(t('local.missingShell', { shell }));
  return { file, args: ['-i'] };
}

class LocalSessions {
  constructor({ send, t = english }) {
    this.items = new Map();
    this.send = send;
    this.t = t;
  }

  start(id, shell, size) {
    if (typeof id !== 'string' || !/^local:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id) || this.items.has(id)) {
      throw Error(this.t('local.invalidId'));
    }
    const { cols, rows } = dimensions(size?.cols, size?.rows, this.t);
    const { file, args } = shellCommand(shell, this.t);
    const name = 'xterm-256color';
    const env = { ...process.env, TERM: name, COLORTERM: 'truecolor', TERM_PROGRAM: 'SilkTerminal' };
    if (!windows) env.SHELL = file;
    const pty = require('node-pty').spawn(file, args, { name, cols, rows, cwd: os.homedir(), env });
    const session = { pty, pending: 0, seq: 0, exited: false };
    this.items.set(id, session);

    pty.onData(data => {
      if (this.items.get(id) !== session) return;
      pty.pause();
      session.pending = ++session.seq;
      this.send({ id, type: 'data', data, seq: session.pending });
    });
    pty.onExit(({ exitCode }) => {
      session.exited = true;
      if (this.items.get(id) !== session) return;
      if (Number.isInteger(exitCode) && exitCode !== 0) {
        const key = windows ? 'local.exitWsl' : 'local.exit';
        this.send({ id, type: 'notice', message: this.t(key, { shell, code: exitCode }) });
      }
      if (!session.pending) this.close(id);
    });
    pty.on('error', error => {
      if (error.code === 'EIO' || error.code === 'EAGAIN' || this.items.get(id) !== session) return;
      this.send({ id, type: 'error', message: error.message });
      this.close(id);
    });
    this.send({ id, type: 'ready' });
  }

  ack(id, seq) {
    const session = this.items.get(id);
    if (!session?.pending || seq !== session.pending) return;
    session.pending = 0;
    if (session.exited) this.close(id);
    else session.pty.resume();
  }

  input(id, data, binary = false) {
    if (typeof data !== 'string' || Buffer.byteLength(data) > 1024 * 1024) throw Error(this.t('terminal.inputLimit'));
    const session = this.items.get(id);
    if (!session || session.exited) return;
    session.pty.write(binary === true ? Buffer.from(data, 'latin1') : data);
  }

  resize(id, cols, rows) {
    dimensions(cols, rows, this.t);
    const session = this.items.get(id);
    if (session && !session.exited) session.pty.resize(cols, rows);
  }

  close(id) {
    const session = this.items.get(id);
    if (!session) return;
    this.items.delete(id);
    if (!session.exited) {
      session.pty.resume();
      session.pty.destroy();
    }
    this.send({ id, type: 'closed' });
  }

  closeAll() {
    for (const id of this.items.keys()) this.close(id);
  }
}

module.exports = { LocalSessions };
