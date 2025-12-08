# Always-On Context (200-500 tokens)

## Project Identity
**Name**: Daisu Dice Simulator
**Tech Stack**: React 19 + Three.js + Rapier Physics + Zustand
**Purpose**: Realistic 3D dice rolling with haptic feedback and inventory management

## Core Architecture Decisions
1. **State Management**: Zustand stores (no Redux)
   - `useDiceManagerStore`: Active dice on table
   - `useInventoryStore`: Owned dice collection
   - `useUIStore`: UI preferences (haptics, theme)

2. **3D Rendering**: React Three Fiber (declarative Three.js)
   - `@react-three/fiber` for React integration
   - `@react-three/drei` for helpers
   - `@react-three/rapier` for physics

3. **Physics**: Rapier (Rust-based, deterministic)
   - RigidBody components for dice
   - Collision detection via onContactForce
   - All constants in `src/config/physicsConfig.ts`

4. **Testing**: Vitest + React Testing Library (TDD workflow)
   - Tests required before implementation
   - Target: >80% coverage
   - Current: 97 tests passing

5. **Styling**: Inline CSS-in-JS (no Tailwind/Bootstrap)
   - Theme system with 5 themes
   - Theme tokens in `src/themes/tokens.ts`

## Project Structure
```
src/
├── components/   # UI (dice, panels, layout, icons)
├── hooks/        # Custom React hooks
├── store/        # Zustand stores (3 stores)
├── lib/          # Utilities (geometries, haptics, customDiceDB)
├── config/       # Physics constants, starter dice
└── themes/       # Theme system (tokens, registry)
```

## Active Constraints
- React 19 patterns only (hooks, no classes)
- TDD required (tests before code)
- Mobile-first (touch + haptic support)
- No external UI libraries (custom components)
- Inventory-based dice limiting (can't spawn more than owned)

## Key Features
- Multiple dice types (d4, d6, d8, d10, d12, d20)
- Custom dice upload (GLB models via IndexedDB)
- Haptic feedback on collisions (Web Vibration API)
- Saved rolls with bonuses (flat + per-die)
- Theme system (5 themes: Neon Noir, Synthwave, etc.)
