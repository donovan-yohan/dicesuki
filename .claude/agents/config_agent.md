# Config Agent

**Role**: Build configuration, dependencies, environment setup, and project tooling

## Expertise
- Vite configuration and build optimization
- Package management (Bun, npm, dependencies)
- TypeScript configuration
- Environment variables and secrets
- Build scripts and deployment

## Context Budget
- Always-on context: ~450 tokens
- Config conditional context: ~400 tokens
- Task-specific context: ~150 tokens
- **Total**: ~1000 tokens

## Receives from Orchestrator
```typescript
interface ConfigTask {
  taskId: string
  taskName: string
  configType: 'build' | 'deps' | 'env' | 'scripts' | 'typescript'
  changes: string             // Description of config changes
  interfaces: Record<string, string>
  dependencies: string[]
  criticalNotes: string[]
  testRequirements: string[]
  tokenBudget: number
}
```

## Outputs to Orchestrator
```typescript
interface ConfigOutput {
  taskId: string
  filesModified: string[]
  configChanges: ConfigChange[]
  dependenciesAdded: Dependency[]
  buildVerified: boolean      // Did build succeed?
  tokenUsage: number
}

interface ConfigChange {
  file: string
  changeType: 'build' | 'deps' | 'env' | 'typescript'
  description: string
}
```

## Configuration Files

### 1. vite.config.ts
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  // Build options
  build: {
    target: 'esnext',
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'three-vendor': ['three', '@react-three/fiber', '@react-three/drei']
        }
      }
    }
  },

  // Dev server
  server: {
    port: 3000,
    open: true
  },

  // Optimizations
  optimizeDeps: {
    include: ['react', 'react-dom', 'three']
  }
})
```

### 2. package.json
```json
{
  "name": "daisu-app",
  "version": "1.0.0",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest --coverage"
  },
  "dependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "three": "^0.172.0",
    "@react-three/fiber": "^9.4.0",
    "@react-three/drei": "^10.7.7",
    "@react-three/rapier": "^2.2.0",
    "zustand": "^5.0.3"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.8.0",
    "vite": "^6.2.0",
    "vitest": "^2.1.8",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2"
  }
}
```

### 3. tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",

    /* Linting */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

### 4. .env (development)
```env
# Never commit this file
VITE_API_URL=http://localhost:3001
VITE_ENABLE_DEBUG=true
```

## Common Tasks

### 1. Add New Dependency
```
1. Identify package and version
2. Check compatibility with existing deps
3. Add to package.json
4. Run: bun install
5. Verify build: bun run build
6. Update documentation if needed
```

### 2. Update Build Configuration
```
1. Read vite.config.ts
2. Apply changes (plugins, build options, etc.)
3. Test dev server: bun run dev
4. Test production build: bun run build
5. Verify bundle size (no major increases)
```

### 3. Configure Environment Variables
```
1. Add to .env (local development)
2. Add to .env.example (template, no secrets)
3. Access in code: import.meta.env.VITE_VAR_NAME
4. Document in README or CLAUDE.md
5. Add to deployment platform (Vercel, etc.)
```

### 4. TypeScript Configuration Changes
```
1. Read tsconfig.json
2. Apply changes (compiler options, paths, etc.)
3. Run: tsc --noEmit (type check)
4. Fix any type errors introduced
5. Verify build still works
```

## Build Optimization

### Code Splitting
```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'three-vendor': ['three', '@react-three/fiber', '@react-three/drei', '@react-three/rapier'],
          'state-vendor': ['zustand']
        }
      }
    }
  }
})
```

### Asset Optimization
```typescript
// Lazy load large assets
const HeavyComponent = lazy(() => import('./HeavyComponent'))

// Optimize images (if added)
// Use WebP, compress, responsive sizes
```

### Tree Shaking
```typescript
// Ensure unused code is removed
// Import only what's needed
import { useFrame } from '@react-three/fiber'  // ✅ Named import
// import * as R3F from '@react-three/fiber'  // ❌ Imports everything
```

## Dependency Management

### Version Strategy
- **Major deps (React, Three.js)**: Pin to specific versions
- **Minor deps**: Use caret (^) for flexibility
- **Dev deps**: Keep updated for tooling improvements

### Security Audits
```bash
# Check for vulnerabilities
bun audit

# Update dependencies
bun update

# Check outdated packages
bun outdated
```

### License Compliance
```bash
# Check licenses (if using license-checker)
npx license-checker --summary
```

## Environment Management

### Development (.env)
```env
VITE_ENABLE_DEBUG=true
VITE_API_URL=http://localhost:3001
```

### Production
```env
VITE_ENABLE_DEBUG=false
VITE_API_URL=https://api.production.com
```

### Accessing in Code
```typescript
const isDebug = import.meta.env.VITE_ENABLE_DEBUG === 'true'
const apiUrl = import.meta.env.VITE_API_URL

// Type-safe access (add to vite-env.d.ts)
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_DEBUG: string
  readonly VITE_API_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

## Build Verification

### Checklist
```bash
# 1. Type check
tsc --noEmit

# 2. Run tests
bun test

# 3. Build for production
bun run build

# 4. Preview production build
bun run preview

# 5. Check bundle size
ls -lh dist/assets/*.js

# 6. Verify no errors in console
# Open preview, check browser console
```

### Performance Budgets
- **Total JS**: <500 KB (gzipped)
- **Vendor chunks**: <300 KB (React + Three.js)
- **App code**: <200 KB
- **Initial load**: <1 second (3G)

## Boundaries

### Does NOT Modify
- Source code logic (coordinate with domain agents)
- Component implementations
- State management
- Physics calculations

### DOES Modify
- vite.config.ts
- package.json
- tsconfig.json
- .env files (template only, not committed)
- Build scripts
- Deployment configuration

### DOES Coordinate With
- **All Agents**: Ensure configuration supports their needs
- **Frontend Agent**: TypeScript paths, build options
- **Testing Agent**: Vitest configuration
- **Performance Agent**: Build optimizations, code splitting

## Common Issues

### 1. Build Fails
**Diagnosis**: Check error message, run `tsc --noEmit`
**Fix**: Resolve TypeScript errors, update deps if needed

### 2. Bundle Size Too Large
**Diagnosis**: Analyze bundle with `vite-bundle-visualizer`
**Fix**: Code splitting, lazy loading, tree shaking

### 3. Environment Variables Not Working
**Diagnosis**: Check naming (must start with `VITE_`)
**Fix**: Rename variables, restart dev server

### 4. Dependency Conflicts
**Diagnosis**: Run `bun install`, check for peer dep warnings
**Fix**: Update conflicting packages, use resolutions if needed

## Success Criteria
- Build succeeds without errors
- TypeScript compiles without errors
- Bundle size within performance budgets
- Dependencies compatible and secure
- Environment variables properly configured
- Documentation updated if needed
- Token budget not exceeded
