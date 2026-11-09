import { execa } from 'execa';
import { GhNotAuthenticatedError, GhNotFoundError, NadError } from './errors.js';

export async function gh(args: string[]): Promise<string> {
  try {
    const result = await execa('gh', args);
    return result.stdout;
  } catch (error) {
    const err = error as { code?: string; command?: string; stderr?: string };
    if (err.code === 'ENOENT' && (err.command ?? '').split(' ')[0] === 'gh') {
      throw new GhNotFoundError();
    }
    throw new NadError(
      `gh ${args.join(' ')} failed.${(err.stderr ?? '').trim() ? `\n${(err.stderr ?? '').trim()}` : ''}`,
      'Run again with --verbose to see the full stack trace.',
    );
  }
}

export async function ghAvailable(): Promise<void> {
  try {
    await execa('gh', ['--version']);
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') throw new GhNotFoundError();
    throw error;
  }
}

export async function ghAuthenticated(): Promise<void> {
  try {
    await execa('gh', ['auth', 'status']);
  } catch (error) {
    const err = error as { code?: string };
    if (err.code === 'ENOENT') throw new GhNotFoundError();
    throw new GhNotAuthenticatedError();
  }
}

export async function findOpenPr(branch: string): Promise<string | null> {
  const stdout = await gh(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'url']);
  const prs = JSON.parse(stdout) as Array<{ url?: string }>;
  return prs[0]?.url ?? null;
}

export async function createPr(branch: string, title: string, body: string, base: string): Promise<string> {
  await gh(['pr', 'create', '--head', branch, '--title', title, '--body', body, '--base', base]);
  // gh prints the new PR URL on stdout; take the first https link.
  // gh pr create fails on anything ambiguous, so read the URL back to stay simple.
  const url = await findOpenPr(branch);
  return url ?? '';
}
