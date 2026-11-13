import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ChecksFailedError, ChecksNotReportedError, GhNotFoundError, NadError } from './errors.js';
import { createPr, mergePr, waitForChecks } from './github.js';

function failing(stderr: string): () => never {
  const error = new Error(`gh failed\n${stderr}`);
  return () => {
    throw error;
  };
}

test('waitForChecks: retries briefly when checks are not registered yet', async () => {
  let calls = 0;
  await waitForChecks(
    'feature/x',
    async () => {
      calls++;
      if (calls === 1) failing('no checks reported yet. Run gh pr status')();
    },
    0,
  );
  assert.equal(calls, 2);
});

test('waitForChecks: no checks after all retries throws ChecksNotReportedError', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      waitForChecks(
        'feature/x',
        async () => {
          calls++;
          failing('no checks reported')();
        },
        0,
      ),
    ChecksNotReportedError,
  );
  assert.equal(calls, 3);
});

test('waitForChecks: failed checks throw ChecksFailedError with the reason', async () => {
  await assert.rejects(
    () => waitForChecks('feature/x', failing('2 of 3 checks failed'), 0),
    (error: unknown) =>
      error instanceof ChecksFailedError && /2 of 3 checks failed/.test(error.message),
  );
});

test('waitForChecks: missing gh rethrows GhNotFoundError', async () => {
  await assert.rejects(
    () => waitForChecks('feature/x', () => { throw new GhNotFoundError(); }, 0),
    GhNotFoundError,
  );
});

test('createPr: throws when the URL cannot be read from stdout', async () => {
  await assert.rejects(
    () => createPr('feature/x', 'title', 'body', 'main', async () => 'no url here'),
    (error: unknown) =>
      error instanceof NadError && /URL could not be read/.test(error.message),
  );
});

test('createPr: returns the URL from stdout', async () => {
  const url = await createPr(
    'feature/x',
    'title',
    'body',
    'main',
    async () => 'Creating pull request...\nhttps://example.com/pr/1',
  );
  assert.equal(url, 'https://example.com/pr/1');
});

test('mergePr: squash-merges and deletes the branch', async () => {
  let args: string[] = [];
  await mergePr('feature/x', async (given) => {
    args = given;
    return '';
  });
  assert.deepEqual(args, ['pr', 'merge', 'feature/x', '--squash', '--delete-branch']);
});
