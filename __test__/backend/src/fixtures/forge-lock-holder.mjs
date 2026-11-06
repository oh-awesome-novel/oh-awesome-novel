import { Hono } from 'hono';
import { createEmptyForgeBrief } from '@oh-awesome-novel/core';
import { createForgeHandlers } from '@oh-awesome-novel/backend';

const [root, id] = process.argv.slice(2);
const handlers = createForgeHandlers({
  getWorkspaceRoot: () => root,
  getStore: async () => { throw new Error('Unexpected approval store access.'); },
  getModelRuntime: async () => { throw new Error('Unexpected live provider access.'); },
  generate: async () => {
    await new Promise(resolve => {
      process.once('message', message => {
        if (message === 'crash') process.exit(0);
        resolve();
      });
      process.send('locked');
    });
    const questions = [1, 2].map(index => ({
      id: `q${index}`, title: '她怎么回应？', why: '确定关系', kind: 'single',
      options: [{ label: '冷静', sample: '走吧。' }, { label: '关心', sample: '我等你。' }],
    }));
    return `<reply>从渡口开始。</reply><questions>${JSON.stringify(questions)}</questions><brief>${JSON.stringify(createEmptyForgeBrief())}</brief>`;
  },
});
const app = new Hono();
app.post('/discuss', context => handlers.operation(context, id, 'discuss'));
const response = await app.request('/discuss', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ expectedWorkspaceRoot: root, expectedRevision: 0, message: '继续讨论' }),
});
if (response.status !== 200) throw new Error(await response.text());
process.disconnect();
