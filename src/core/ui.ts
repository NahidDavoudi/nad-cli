import pc from 'picocolors';

export const ui = {
  success: (msg: string) => console.log(`${pc.green('✔')} ${msg}`),
  info: (msg: string) => console.log(`${pc.cyan('ℹ')} ${msg}`),
  warn: (msg: string) => console.warn(`${pc.yellow('⚠')} ${pc.yellow(msg)}`),
  error: (msg: string) => console.error(`${pc.red('✖')} ${pc.red(msg)}`),
  hint: (msg: string) => console.error(`  ${pc.dim('→ ' + msg)}`),
  plain: (msg: string) => console.log(msg),
  code: (text: string) => pc.cyan(text),
  name: (text: string) => pc.bold(pc.magenta(text)),
};