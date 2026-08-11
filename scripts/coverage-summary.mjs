/**
 * Render `coverage/coverage-summary.json` as a markdown table for the GitHub job summary.
 * Exits quietly when there is no coverage report, so it is safe to run unconditionally.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const REPORT = 'coverage/coverage-summary.json';

if (!existsSync(REPORT)) {
  console.warn(`No coverage report at ${REPORT}; skipping summary.`);
  process.exit(0);
}

const total = JSON.parse(readFileSync(REPORT, 'utf8')).total;
const metrics = ['lines', 'statements', 'functions', 'branches'];

const rows = metrics.map((metric) => {
  const { pct, covered, total: count } = total[metric];
  return `| ${metric} | ${pct}% | ${covered}/${count} |`;
});

const table = ['### Coverage', '', '| Metric | Percentage | Covered |', '|---|---|---|', ...rows, ''].join(
  '\n',
);

console.warn(table);

const summaryFile = process.env.GITHUB_STEP_SUMMARY;
if (summaryFile) appendFileSync(summaryFile, `${table}\n`);
