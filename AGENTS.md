# Repository Guidelines

## Project Structure & Module Organization
Source lives in `src/`, with React components under `components/` (dice geometry in `components/dice`, physics helpers in `components/physics`, UI overlay in `components/ui`, and post-processing in `components/effects`). Shared logic should land in `hooks/`, Zustand stores in `store/`, and cross-cutting utilities in `lib/`. Static textures stay in `public/textures`, while build and tooling configs (`vite.config.ts`, `tailwind.config.js`, `tsconfig*.json`) sit at the root.

## Build, Test, and Development Commands
Use `npm run dev` for the HTTPS-enabled Vite server, and `npm run build` (TypeScript compile + Vite bundle) before publishing changes. `npm run preview` serves the production build for sanity checks. Run `npm run lint` to apply the ESLint + TypeScript ruleset, and `npm run test`, `npm run test:ui`, or `npm run test:coverage` for Vitest in CLI, browser UI, or coverage modes respectively.

## Coding Style & Naming Conventions
Stick to TypeScript, 2-space indentation, and ES module syntax. Components remain stateless where possible and live as PascalCase files (`Scene.tsx`), hooks use camelCase with a `use` prefix, and Zustand stores end in `Store.ts`. Prefer Tailwind utility classes over ad-hoc CSS; extend design tokens in `tailwind.config.js` instead of scattering magic values. Lint before pushing; ESLint blocks unused disables and React hook misuse.

## Testing Guidelines
Vitest plus Testing Library power unit and interaction tests. Co-locate specs next to implementations using the `*.test.ts(x)` suffix (e.g., `useDiceRoll.test.ts`). Write scenario names that describe the expected roll/physics behavior, and mock Rapier where deterministic output is needed. Run `npm run test` locally, ensure `npm run test:coverage` stays above 80% lines for critical modules (`components/Scene`, `hooks/useDiceRoll`, `store/*`).

## Commit & Pull Request Guidelines
Follow the Conventional Commits pattern already in the log (`feat(device-motion): …`, `fix(build): …`). Keep the scope meaningful (`dice`, `dev`, `physics`) and the summary in imperative mood. PRs should explain the gameplay or performance impact, list testing commands executed, reference related issues/spec items, and include media when UI changes affect dice rendering. Small, focused PRs accelerate review and keep the physics pipeline easy to bisect.

## Performance & Configuration Notes
GPU capability checks and physics tuning live in `lib/deviceDetection.ts` and `components/physics/*`; test on both high- and mid-tier hardware before merging. When adjusting HTTPS or cert behavior, update `vite.config.ts` and document any new environment variables in `README.md` so other agents can reproduce the setup.
