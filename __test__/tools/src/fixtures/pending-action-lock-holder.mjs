import { createPendingActionStore } from '@oh-awesome-novel/tools';

const store = await createPendingActionStore({ workspaceRoot: process.argv[2] });
await store.withMaterializationLocks('holder', async () => {
  await new Promise((resolve) => {
    process.once('message', (message) => {
      if (message === 'crash') process.exit(0);
      resolve();
    });
    process.send('locked');
  });
});
process.disconnect();
