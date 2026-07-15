# Dicesuki - 3D Dice Simulator

A mobile-optimized 3D dice rolling simulator built with React Three Fiber and Rapier physics.

## 🎯 Project Status

**Phase 0: Setup & Validation** ✅ COMPLETE

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start development server (solo runs entirely in-browser via the WASM room worker)
npm run dev

# Run the solo worker-room browser smoke (no native server needed)
npm run test:e2e:solo

# Build for production
npm run build

# Preview production build
npm run preview
```

## 📦 Tech Stack

- **Framework**: React 18 + TypeScript
- **3D Rendering**: @react-three/fiber + @react-three/drei
- **Physics**: @react-three/rapier (Rapier.rs via React)
- **State Management**: Zustand
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **Device Detection**: detect-gpu

## 🏗️ Project Structure

```
daisu-app/
├── src/
│   ├── components/
│   │   ├── Scene.tsx              # Main R3F Canvas wrapper
│   │   ├── dice/                  # Dice components (D4-D20)
│   │   ├── physics/               # Physics world components
│   │   ├── ui/                    # UI overlay components
│   │   └── effects/               # Visual effects
│   ├── hooks/
│   │   ├── usePerformanceMonitor.tsx  # FPS tracking
│   │   ├── useDeviceOrientation.ts    # Device motion input
│   │   ├── useDiceRoll.ts            # Roll orchestration
│   │   └── useFaceDetection.ts       # Face detection logic
│   ├── store/
│   │   ├── diceStore.ts          # Selected dice state
│   │   ├── skinStore.ts          # Skins & selection
│   │   └── historyStore.ts       # Roll history
│   ├── lib/
│   │   ├── deviceDetection.ts    # GPU tier check
│   │   ├── geometries.ts         # Pre-computed normals
│   │   └── storage.ts            # localStorage wrapper
│   ├── App.tsx                   # Root component
│   ├── main.tsx                  # Entry point
│   └── index.css                 # Tailwind imports
├── public/
│   └── textures/                 # Dice skin textures
├── index.html
├── vite.config.ts
├── tailwind.config.js
└── tsconfig.json
```

## ✨ Features Implemented (Phase 0)

- ✅ Device compatibility check (GPU tier detection)
- ✅ Performance monitoring (FPS tracking, toggle with Ctrl+Shift+P)
- ✅ React Three Fiber scene setup
- ✅ Rapier physics world integration
- ✅ Responsive layout foundation
- ✅ Development environment configured

## 🎮 Planned Features

### Phase 1 (In Progress)
- [ ] Single D6 dice component
- [ ] Basic roll mechanics (button trigger)
- [ ] Face detection (at-rest + result reading)
- [ ] DeviceMotion permission flow

### Phase 2
- [ ] All dice shapes (D4, D8, D10, D12, D20)
- [ ] Multiple dice rolling
- [ ] Touch/drag toss input
- [ ] Device tilt controls

### Phase 3
- [ ] Skin system with texture support
- [ ] Critical/failure visual effects
- [ ] Skin persistence

### Phase 4
- [ ] Roll history with localStorage
- [ ] Performance optimization (LOD)
- [ ] Layout polish (portrait/landscape)

### Phase 5
- [ ] Cross-device testing
- [ ] Production deployment
- [ ] Final performance validation

## 📱 Target Devices

**Minimum Requirements:**
- iPhone 12+ (2020) or iPad Air 4+ (2020)
- Android: 4GB+ RAM, 2021+ chipset
- WebGL 2.0 support
- GPU Tier 2+ (mid-range or better)

**Performance Goals:**
- 60fps with 4 dice
- 30fps with 6 dice (max)

## 🔧 Development

### Solo Room (in-browser WASM worker)

The default `/` route opens a one-player room hosted by the in-browser **WASM room worker** — the SAME `dicesuki-core` engine, constants, and settings the native multiplayer server links, compiled to WASM and driven inside a Web Worker over `postMessage`. `npm run dev` is all that solo needs: **no native room server, no health check, no network**. Multiplayer still connects over WebSocket through the same store transport abstraction (`RoomSocket`), unchanged for users.

Public multiplayer server config: `VITE_MULTIPLAYER_SERVER_URL` / `VITE_MULTIPLAYER_SERVER_HTTP_URL`.

To rebuild the committed WASM room artifacts after changing `server/core` or `server/wasm`, run `npm run build:wasm-room`.

### Solo Browser Smoke

`npm run test:e2e:solo` runs `e2e/solo-wasm-room.spec.ts` against Vite alone (no Rust server). It loads `/`, waits for the solo room to reach `connected` via the worker, and asserts no network room WebSocket was opened. Override `PLAYWRIGHT_TEST_PORT` if the Vite port is occupied.

### Performance Monitoring

Press `Ctrl+Shift+P` to toggle the performance overlay showing:
- Current FPS
- Frame time in milliseconds
- Average FPS over last 60 frames

### Device Detection

The app automatically checks GPU capabilities on load:
- Blocks devices with GPU Tier < 2
- Falls back to graceful degradation if detection fails
- Logs detailed GPU info to console

## 🚨 Known Issues

- Minor deprecation warnings in dependencies (non-critical)
- Physics debug mode enabled (will be removed for production)

## 📝 License

MIT

## 🤝 Contributing

This is a personal project, but feedback and suggestions are welcome!
