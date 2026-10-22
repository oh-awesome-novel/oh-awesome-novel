import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'text-speaker-parser': 'src/text-speaker-parser.ts',
    'novel-copilot-contract': 'src/novel-copilot-contract.ts',
    'agent-usage': 'src/agent-usage.ts',
    'play-event-evidence': 'src/play-event-evidence.ts',
  },
  format: 'esm',
  outDir: 'dist',
  dts: true,
  sourcemap: true,
  clean: true,
  platform: 'node',
});
