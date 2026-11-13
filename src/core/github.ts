import { execa } from 'execa';
import { ChecksFailedError, ChecksNotReportedError, GhNotAuthenticatedError, GhNotFoundError, NadError } from './errors.js';

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

export async function findOpenPr(branch: string, run: (args: string[]) => Promise<string> = gh): Promise<string | null> {
  const stdout = await run(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'url']);
  const prs = JSON.parse(stdout) as Array<{ url?: string }>;
  return prs[0]?.url ?? null;
}

export async function createPr(
  branch: string,
  title: string,
  body: string,
  base: string,
  run: (args: string[]) => Promise<string> = gh,
): Promise<string> {
  const stdout = await run(['pr', 'create', '--head', branch, '--title', title, '--body', body, '--base', base]);
  // gh pr create fails on anything ambiguous; its stdout contains the PR URL.
  const url = stdout.match(/https:\S+/)?.[0];
  if (!url) throw new NadError('PR was created but its URL could not be read.', 'Check `gh pr list`.');
  return url;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForChecks(
  branch: string,
  run: (args: string[]) => Promise<unknown> = gh,
  delay = 5000,
): Promise<void> {
  const attempts = 3;
  for (let i = 0; i < attempts; i++) {
    try {
      await run(['pr', 'checks', branch, '--watch', '--fail-fast']);
      return;
    } catch (error) {
      if (error instanceof GhNotFoundError) throw error;
      const err = error as { stderr?: string; stdout?: string; message?: string };
      const text = `${err.message ?? ''}${err.stderr ?? ''}${err.stdout ?? ''}`;
      if (/no checks reported/i.test(text)) {
        // Right after PR creation, CI may not have registered yet: retry briefly.
        // Still empty after the retries: do not merge untested code.
        if (i < attempts - 1) await sleep(delay);
        continue;
      }
      throw new ChecksFailedError([err.message, err.stderr].filter(Boolean).join('\n').trim() || undefined);
    }
  }
  throw new ChecksNotReportedError(branch);
}

export async function mergePr(
  branch: string,
  run: (args: string[]) => Promise<string> = gh,
): Promise<void> {
  await run(['pr', 'merge', branch, '--squash', '--delete-branch']);
}
