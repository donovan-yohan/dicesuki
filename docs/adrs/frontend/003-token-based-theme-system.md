# ADR 003 - Token-Based Theme System

* Date: 2026/02/15
* Status: Accepted
* Deciders: Donovan, Development Team

## Context

Daisu supports multiple visual themes as purchasable cosmetic skins. Themes affect the entire visual experience: UI colors and typography, dice materials and colors, 3D environment (floor, walls, lighting), and future assets (icons, sounds, backgrounds). Themes must be swappable at runtime without page reload, and users should be able to override specific aspects of a theme for mix-and-match customization.

The theme system must cover:
- **UI layer:** Colors, typography, spacing, border radius, shadows, gradients
- **3D dice:** Per-type default colors, material properties (roughness, metalness, emissive), numbering style
- **3D environment:** Floor/wall/ceiling colors and materials, lighting setup, background/skybox
- **Assets:** UI backgrounds, button assets, icon sets, sound effects (all nullable for progressive enhancement)
- **User overrides:** Partial overrides on top of any base theme

## Decision

The theme system MUST use a **design token architecture** defined in `src/themes/tokens.ts`. Each theme is a complete `Theme` object containing nested token groups.

### Token Structure

```typescript
Theme {
  // Metadata
  id, name, description, price, category

  // Design tokens
  tokens: {
    colors: ThemeColors        // UI color palette
    typography: ThemeTypography // Font families, sizes, weights
    spacing: ThemeSpacing      // Base spacing unit
    effects: ThemeEffects      // Border radius, shadows, gradients
  }

  // Asset references (all nullable)
  assets: {
    ui: ThemeUIAssets           // Navbar, button backgrounds
    backgrounds: ThemeBackgrounds
    icons: ThemeIcons
    sounds: ThemeSounds
  }

  // 3D customization
  dice: DiceCustomization      // Per-type colors, materials, numbering
  environment: EnvironmentCustomization  // Floor, walls, ceiling, lighting, background
}
```

### Theme Delivery

- Themes MUST be defined as TypeScript objects in `src/themes/tokens.ts`
- Each theme MUST implement the complete `Theme` interface (no partial themes)
- Asset references (icons, sounds, textures) SHOULD use nullable fields (`string | null`) to allow progressive enhancement; components MUST fall back gracefully when an asset is `null`
- The `defaultTheme` MUST always be available and have `price: 0`

### Theme Application

- `ThemeProvider` (React Context) MUST provide the active theme to the component tree
- UI components SHOULD read theme tokens via the `useTheme()` hook
- 3D scene components MUST read dice and environment tokens from the active theme to configure materials, lighting, and geometry
- Theme switching MUST NOT require a page reload

### User Overrides

- `UserCustomization` allows partial overrides on dice, environment, and UI tokens
- Overrides MUST be deep-merged with the base theme at the provider level
- Override structure mirrors the theme structure using `Partial<>` types

### Current Themes

| ID | Name | Category | Price |
|----|------|----------|-------|
| `default` | Classic Dice | modern | Free |
| `fantasy-earth` | Fantasy Earth | fantasy | $2.99 |
| `critter-forest` | Critter Forest | fantasy | $3.99 |
| `dungeon-castle` | Dungeon Castle | fantasy | $3.99 |
| `neon-cyber-city` | Neon Cyber City | sci-fi | $4.99 |

## Alternatives Considered

**CSS Custom Properties (CSS Variables):** Works well for UI colors and typography but cannot drive Three.js material properties, lighting parameters, or 3D environment configuration. A JavaScript token system is required to bridge both the 2D UI and 3D scene.

**Tailwind Theme Configuration:** Tailwind's `theme.extend` is compile-time only and cannot support runtime theme switching or the 3D customization layer. The app uses Tailwind for utility classes but not for theme token delivery.

**Separate config per theme (JSON files):** Would work but loses TypeScript type safety and IDE autocompletion. Inline TypeScript objects ensure themes conform to the `Theme` interface at compile time.

## Consequences

### Positive

- Single source of truth for all visual configuration across UI and 3D layers
- TypeScript interfaces enforce completeness: every theme must define every token
- Nullable asset fields enable progressive theme development (add icons/sounds later without breaking existing themes)
- User override layer enables future mix-and-match customization (e.g., use Dungeon Castle dice colors with Fantasy Earth environment)
- Adding a new theme is a single object conforming to the `Theme` interface

### Negative / Considerations

- Theme objects are large (~200 lines each); `tokens.ts` file grows linearly with theme count. May need to split into per-theme files if the catalog grows significantly
- No hot-reload for theme changes during development (requires re-render)
- 3D material properties (roughness, metalness, emissive) require manual tuning per theme; no visual editor exists
- Asset references are currently all `null` (placeholder); the asset pipeline for icons, textures, and sounds is not yet built
- Price field exists but no purchase/unlock flow is implemented yet
