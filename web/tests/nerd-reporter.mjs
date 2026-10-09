// Each test reported to nerd as a part (a line of JSON in $NERD_REPORT), so that a failure names the test and what it
// said, and each has a usual time of its own. Vitest's reporter interface (onTestCaseResult).
import { appendFileSync } from 'node:fs';

export default class NerdReporter {
  onTestCaseResult(test) {
    const file = process.env.NERD_REPORT;
    if (!file) return;
    const result = test.result();
    const outcome = result.state === 'failed' ? 'failed' : result.state === 'skipped' ? 'skipped' : 'passed';
    const line = { part: test.fullName.replace(/ > /g, ' › '), seconds: Number((test.diagnostic()?.duration / 1000 || 0).toFixed(2)), outcome };
    if (outcome === 'failed') line.said = String(result.errors?.[0]?.message ?? '').split('\n')[0];
    if (outcome === 'skipped' && result.note) line.said = result.note;
    appendFileSync(file, `${JSON.stringify(line)}\n`);
  }
}
