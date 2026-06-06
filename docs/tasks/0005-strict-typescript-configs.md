# 0005 Strict TypeScript Configs

> Status: Completed
> Completed in: `088c864 build(tsconfig): enable strict erasable syntax checks`

## Goal

为主要 TypeScript package 建立严格配置，并提前约束代码只使用 erasable TypeScript syntax，为后续 TypeScript 7 升级留空间。

## Delivered

- `apps/desktop/tsconfig.json`
- `packages/core/tsconfig.json`
- `packages/tools/tsconfig.json`
- `packages/runtime/tsconfig.json`
- Runtime 去除参数属性语法，兼容 `erasableSyntaxOnly`。

## Required Compiler Options

```json
{
  "strict": true,
  "erasableSyntaxOnly": true
}
```

## Done Criteria

- `npx tsc -p apps/desktop/tsconfig.json` 通过。
- `npx tsc -p packages/core/tsconfig.json` 通过。
- `npx tsc -p packages/tools/tsconfig.json` 通过。
- `npx tsc -p packages/runtime/tsconfig.json` 通过。
- 没有添加 `"ignoreDeprecations": "6.0"`。

## Non Goals

- 不切换到 `moduleResolution: "NodeNext"`，避免当前 extensionless imports 被迫大范围迁移。
- 不让 TypeScript 自己 emit 生产产物；库包仍由 tsdown 构建。
