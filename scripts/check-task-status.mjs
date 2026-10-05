import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const tasksDirectory = new URL('../docs/tasks/', import.meta.url);
const index = readFileSync(new URL('README.md', tasksDirectory), 'utf8');
const indexed = new Map();
const errors = [];
let section;

for (const line of index.split(/\r?\n/u)) {
  if (line.startsWith('## ')) section = /^## (Completed|Needs Review|Planned|Blocked) Tasks$/u.exec(line)?.[1];
  const task = /^- \[[^\]]+\]\((\d{4}\.md)\)/u.exec(line)?.[1];
  if (!section || !task) continue;
  if (indexed.has(task)) errors.push(`${task}: duplicate task index entry`);
  indexed.set(task, section);
}

const files = readdirSync(tasksDirectory).filter((file) => /^\d{4}\.md$/u.test(file));
for (const file of files) {
  const content = readFileSync(new URL(file, tasksDirectory), 'utf8');
  const status = /^> Status: (Completed|Needs Review|Planned|Blocked)$/mu.exec(content)?.[1];
  if (!status) errors.push(`${file}: missing or invalid status`);
  if (!indexed.has(file)) errors.push(`${file}: missing from task index`);
  else if (status !== indexed.get(file)) errors.push(`${file}: status ${status} differs from index ${indexed.get(file)}`);
}
for (const file of indexed.keys()) {
  if (!files.includes(file)) errors.push(`${file}: indexed task file is missing`);
}

if (errors.length) {
  throw new Error(`Task status check failed (${fileURLToPath(tasksDirectory)}):\n${errors.join('\n')}`);
}
console.log(`Task status check passed (${files.length} tasks).`);
