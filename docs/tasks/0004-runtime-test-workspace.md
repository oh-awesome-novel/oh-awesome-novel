# 0004 Runtime Test Workspace

> Status: Completed
> Milestone: M1 Project Scaffolding / M7 Aider-style Copilot Runtime
> Completed in: `b51449e feat(runtime): add lightweight copilot runtime`

## Goal

创建独立测试 workspace，用 fake model adapter 验证 runtime loop，避免测试真实调用 LLM。

## Delivered

- `__test__/runtime`
- Vitest test workspace。
- fake model helper。
- in-memory tool helper。
- runtime loop 单元测试。
- `__test__/*` 保留为专门测试 workspace。

## Done Criteria

- `npm run test:run --workspace @oh-awesome-novel/test-runtime` 通过。
- 测试不读取 API key。
- 测试不发网络请求。
- 测试覆盖 no-tool、read tool、write intent、unknown tool、tool exception、max loop、tool registry、context builder。

## Non Goals

- 不安装 `@ai-sdk/openai`。
- 不用真实模型。
- 不把测试包发布成生产包。
