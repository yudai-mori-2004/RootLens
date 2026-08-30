import { spawn } from 'node:child_process';
import readline from 'node:readline';

export function run(command, args, { cwd, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    const lines = readline.createInterface({ input: child.stderr });
    lines.on('line', (line) => {
      stderr += `${line}\n`;
      onLine?.(line);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} failed (${code}): ${stderr.trim() || stdout.trim()}`));
    });
  });
}

export function streamLines(command, args, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', onLine);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${code}): ${stderr.trim()}`));
    });
  });
}
