const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { accessSync, constants } = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const test = require('node:test');
const { LocalSessions, defaultLocalShell, normalizeLocalShell, shellCommand } = require('../electron/local.cjs');
const { cjkSample } = require('../i18n/samples.json');

const sessionId = () => `local:${randomUUID()}`;
const size = { cols: 80, rows: 24 };

function hasShell(shell) {
  if (process.platform === 'win32') return false;
  return (process.env.PATH || '/usr/bin:/bin').split(path.delimiter).some(directory => {
    if (!path.isAbsolute(directory)) return false;
    try { accessSync(path.join(directory, shell), constants.X_OK); return true; } catch { return false; }
  });
}

async function waitFor(predicate, description) {
  for (let tries = 0; tries < 150; tries++) {
    if (predicate()) return;
    await delay(20);
  }
  assert.fail(description);
}

test('local sessions reject arbitrary programs and malformed sizes', () => {
  const manager = new LocalSessions({ send() {} });
  assert.throws(() => manager.start(sessionId(), '/bin/sh', size), /Choose the system default, Bash, or Zsh/);
  assert.throws(() => manager.start(sessionId(), 'bash', { cols: 0, rows: 24 }), /Invalid terminal dimensions/);
  assert.throws(() => manager.start('unknown', 'bash', size), /Invalid local session ID/);
});

test('local shell defaults use native CMD on Windows, Bash on Linux, and Zsh on macOS', () => {
  const cmd = 'D:\\Windows\\System32\\cmd.exe';
  const win = { platform: 'win32', env: { SystemRoot: 'D:\\Windows' } };
  assert.deepEqual(shellCommand('auto', { ...win, isExecutable: file => file === cmd }), {
    shell: 'cmd', file: cmd, args: []
  });
  assert.throws(() => shellCommand('auto', { ...win, isExecutable: file => file.endsWith('wsl.exe') }), /cmd\.exe/);
  assert.deepEqual(shellCommand('zsh', { ...win, isExecutable: file => file.endsWith('wsl.exe') }), {
    shell: 'zsh', file: 'D:\\Windows\\System32\\wsl.exe', args: ['--cd', '~', '--exec', 'zsh', '-i']
  });
  for (const [platform, shell] of [['linux', 'bash'], ['darwin', 'zsh']]) {
    assert.deepEqual(shellCommand('auto', { platform, env: { PATH: '/bin' }, isExecutable: () => true }), {
      shell, file: '/bin/' + shell, args: ['-i']
    });
  }
  assert.equal(normalizeLocalShell(undefined), 'auto');
  assert.equal(normalizeLocalShell('zsh'), 'zsh');
});

for (const shell of ['bash', 'zsh']) {
  test(`local ${shell}: interactive PTY, output acknowledgments, resize and exit`, { skip: !hasShell(shell), timeout: 15000 }, async t => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-local-'));
    const originalHome = process.env.HOME, originalZdotdir = process.env.ZDOTDIR;
    process.env.HOME = home;
    process.env.ZDOTDIR = home;
    const id = sessionId(), events = [];
    let output = '', acknowledge = false;
    const manager = new LocalSessions({ send(event) {
      events.push(event);
      if (event.type === 'data') {
        output += event.data;
        if (acknowledge) setImmediate(() => manager.ack(event.id, event.seq));
      }
    } });
    t.after(async () => {
      manager.closeAll();
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalZdotdir === undefined) delete process.env.ZDOTDIR;
      else process.env.ZDOTDIR = originalZdotdir;
      await fs.rm(home, { recursive: true, force: true });
    });
    const initFile = shell === 'bash' ? '.bashrc' : '.zshrc';
    await fs.writeFile(path.join(home, initFile), `PS1=''; printf 'INIT_%s\n' ${shell}\n`);
    const preference = shell === defaultLocalShell() ? 'auto' : shell;
    manager.start(id, preference, size);
    assert.equal(events[0].type, 'ready');
    assert.throws(() => manager.start(id, shell, size), /Invalid local session ID/);
    await waitFor(() => events.some(event => event.type === 'data'), 'shell produced no initial output');
    const first = events.find(event => event.type === 'data');
    manager.input(id, `test -t 0 && test -t 1 && test -t 2 && test "$PWD" = "$HOME" && printf 'PTY_%s %s ${cjkSample} 🚀\\n' OK "$TERM"\r`);
    manager.ack(id, first.seq + 1);
    await delay(50);
    assert.equal(events.filter(event => event.type === 'data').length, 1);
    acknowledge = true;
    manager.ack(id, first.seq);
    await waitFor(() => output.includes(`PTY_OK xterm-256color ${cjkSample} 🚀`), 'shell lacks the expected PTY or environment');
    assert.match(output, new RegExp(`INIT_${shell}`));

    manager.resize(id, 119, 43);
    manager.input(id, 'stty size\r');
    await waitFor(() => output.includes('43 119'), 'PTY size was not updated');
    manager.input(id, `sh -c 'printf "RUN_%s\\n" WAIT; exec sleep 30'\r`);
    await waitFor(() => output.includes('RUN_WAIT'), 'foreground job did not start');
    manager.input(id, '\x03');
    manager.input(id, "printf 'EXIT_%s\\n' OK; exit 0\r");
    await waitFor(() => events.some(event => event.type === 'closed'), 'shell was not interrupted or did not exit');
    assert.match(output, /EXIT_OK/);
    manager.close(id);
    assert.equal(manager.items.size, 0);
    assert.equal(events.filter(event => event.type === 'closed').length, 1);

    manager.start(id, preference, size);
    const pty = manager.items.get(id).pty;
    const exited = new Promise(resolve => pty.onExit(resolve));
    manager.close(id);
    await exited;
    assert.equal(manager.items.size, 0);
    assert.equal(events.filter(event => event.type === 'closed').length, 2);
  });
}
