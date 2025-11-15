# UI Layout Quick Reference

**New Layout Structure** - Ready for Phase 2 Implementation

---

## Layout Overview

```
┌─────────────────────────────────────────────────┐
│  ⚙️                                       👤   │ Corner Icons
│  Settings                              Profile │
│                                                 │
│                                                 │
│              3D Dice Viewport                   │
│            (Full Interactive Area)              │
│                                                 │
│                                                 │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │  👁️   🎲   ⚫   📜   📱  │               │ │
│  │  UI  Dice  ROLL Hist Motion              │ │ Bottom Nav
│  └───────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

---

## Component Breakdown

### 1. Bottom Navigation Bar
**File**: `src/components/layout/BottomNav.tsx` (to create)

**Position**: Fixed bottom, full width
**Height**: 80px (mobile), 100px (desktop)
**Z-index**: 40

**5 Buttons (Left to Right)**:

#### Button 1: UI Toggle 👁️
- Icon: Eye emoji or theme icon
- Action: `toggleUIVisibility()`
- Tooltip: "Hide/Show UI"
- Always visible

#### Button 2: Dice Manager 🎲
- Icon: Dice or hamburger
- Action: Opens dice management panel
- Current: HamburgerMenu functionality
- Tooltip: "Manage Dice"

#### Button 3: Roll Button ⚫ (CENTER)
- **Special**: Large circular button
- Diameter: 80px (mobile), 100px (desktop)
- Elevated: +20px above nav bar
- Action: Roll dice
- States:
  - Ready: Pulsing glow
  - Rolling: Spinning animation
  - Disabled: Grayscale
- Current: RollButton functionality

#### Button 4: History 📜
- Icon: Scroll or history icon
- Action: Opens roll history panel
- Current: HistoryDisplay functionality
- Tooltip: "Roll History"

#### Button 5: Motion Toggle 📱
- **Mobile Only**: Hidden on desktop
- Icon: Gesture/shake icon
- Action: `toggleMotionMode()`
- Current: SettingsButton functionality
- Tooltip: "Motion Mode"

**Design Requirements**:
- Theme-aware background: `bg-theme-surface`
- Themed border with glow
- Slide-down animation when hidden (300ms)
- Responsive spacing
- Safe area insets for mobile notches

---

### 2. Top-Left Corner Icon
**File**: `src/components/layout/CornerIcon.tsx` (reusable)

**Position**: Fixed top-left, 16px from edges
**Size**: 56px × 56px
**Z-index**: 30

**Function**: Settings
- Icon: Gear/cog (theme asset)
- Action: Opens settings panel
- Background: `bg-theme-surface`
- Shadow: `shadow-theme-md`

**Animation**:
- Slide-out left when UI hidden (-100px, 300ms)
- Stagger delay: +100ms after nav

---

### 3. Top-Right Corner Icon
**File**: `src/components/layout/CornerIcon.tsx` (reusable)

**Position**: Fixed top-right, 16px from edges
**Size**: 56px × 56px
**Z-index**: 30

**Function**: Profile/Room (placeholder)
- Icon: User avatar or room icon
- Action: Opens profile/room panel (future)
- Background: `bg-theme-surface`
- Shadow: `shadow-theme-md`

**Animation**:
- Slide-out right when UI hidden (+100px, 300ms)
- Stagger delay: +100ms after nav

---

### 4. Mini UI Toggle
**File**: `src/components/layout/UIToggleMini.tsx` (to create)

**Position**: Fixed bottom-left, 16px from edges
**Size**: 48px × 48px
**Z-index**: 10 (below other UI)

**Function**: Show UI
- Only visible when `isUIVisible === false`
- Icon: Eye emoji (theme asset)
- Action: `setUIVisible(true)`
- Background: `bg-theme-surface` with 70% opacity
- Fade-in animation: 200ms delay after UI hides

---

## Animation Specifications

### UI Hide Sequence

1. **Bottom Nav** (0ms start):
   - Transform: `translateY(100%)`
   - Opacity: 0
   - Duration: 300ms
   - Easing: ease-in-out

2. **Top-Left Icon** (100ms start):
   - Transform: `translateX(-100px)`
   - Opacity: 0
   - Duration: 300ms
   - Easing: ease-in-out

3. **Top-Right Icon** (100ms start):
   - Transform: `translateX(100px)`
   - Opacity: 0
   - Duration: 300ms
   - Easing: ease-in-out

4. **Mini Toggle** (400ms start):
   - Opacity: 0 → 0.7
   - Scale: 0.8 → 1
   - Duration: 200ms
   - Easing: ease-out

### UI Show Sequence

Reverse of hide, no delays:
- Mini toggle fades out (200ms)
- All UI elements slide in simultaneously (300ms)

---

## State Management

### UI Visibility State
**Store**: `useUIStore`

```typescript
interface UIStore {
  isUIVisible: boolean
  setUIVisible: (visible: boolean) => void
  toggleUIVisibility: () => void
}
```

**Usage in Components**:
```tsx
const { isUIVisible, toggleUIVisibility } = useUIStore()
```

---

## Responsive Behavior

### Mobile (< 768px)
- Bottom nav height: 80px
- Roll button diameter: 80px
- Motion toggle: **visible**
- Corner icons: 48px × 48px
- Touch targets: minimum 48px
- Haptic feedback on interactions

### Desktop (≥ 768px)
- Bottom nav height: 100px
- Roll button diameter: 100px
- Motion toggle: **hidden**
- Corner icons: 56px × 56px
- Hover states enabled
- Keyboard shortcuts (future)

---

## Theme Integration

### Using Theme Tokens

**Colors**:
```tsx
className="bg-theme-surface text-theme-text border-theme-accent"
```

**Effects**:
```tsx
className="rounded-theme-lg shadow-theme-md"
```

**Typography**:
```tsx
className="font-theme-primary text-theme-xl font-theme-semibold"
```

### Using Themed Assets

```tsx
import { useThemedAsset } from '../hooks/useThemedAsset'

function MyComponent() {
  const { getIcon, hasAsset } = useThemedAsset()

  const rollIcon = getIcon('roll')
  const navBg = useThemedAsset().navbar.background

  return (
    <div>
      <img src={rollIcon} alt="Roll" />
      {hasAsset(navBg) && (
        <div style={{ backgroundImage: `url(${navBg})` }} />
      )}
    </div>
  )
}
```

---

## Component Migration Map

| Old Component         | New Location           | Parent         |
|-----------------------|------------------------|----------------|
| HamburgerMenu         | BottomNav (slot 2)     | BottomNav.tsx  |
| RollButton            | BottomNav (slot 3)     | CenterRollButton.tsx |
| HistoryDisplay        | BottomNav (slot 4)     | BottomNav.tsx  |
| SettingsButton        | BottomNav (slot 5)     | BottomNav.tsx  |
| -                     | Top-Left Icon          | CornerIcon.tsx |
| -                     | Top-Right Icon         | CornerIcon.tsx |

---

## Framer Motion Usage

### Installation
```bash
npm install framer-motion  # ✅ Already installed
```

### Basic Animation Example
```tsx
import { motion } from 'framer-motion'

<motion.div
  initial={{ y: 100, opacity: 0 }}
  animate={{ y: 0, opacity: 1 }}
  exit={{ y: 100, opacity: 0 }}
  transition={{ duration: 0.3, ease: 'easeInOut' }}
>
  Content
</motion.div>
```

### Animation Presets
**File**: `src/animations/ui-transitions.ts` (to create)

```typescript
export const UI_ANIMATIONS = {
  navBar: {
    show: { y: 0, opacity: 1 },
    hide: { y: 100, opacity: 0 }
  },
  topLeftIcon: {
    show: { x: 0, opacity: 1 },
    hide: { x: -100, opacity: 0 }
  },
  // ...etc
}
```

---

## Implementation Checklist

### Phase 2: New Layout Components

#### Week 1
- [ ] Create `src/components/layout/` directory
- [ ] Implement `BottomNav.tsx`
  - [ ] 5-button layout
  - [ ] Responsive sizing
  - [ ] Theme integration
- [ ] Implement `CenterRollButton.tsx`
  - [ ] Circular design
  - [ ] Elevated positioning
  - [ ] Pulse animation (ready state)
  - [ ] Spin animation (rolling state)
- [ ] Implement `CornerIcon.tsx` (reusable)
  - [ ] Top-left variant
  - [ ] Top-right variant
  - [ ] Hover effects
- [ ] Implement `UIToggleMini.tsx`
  - [ ] Mini button design
  - [ ] Fade animation
- [ ] Create `src/animations/ui-transitions.ts`
  - [ ] Animation presets
  - [ ] Timing constants

#### Week 2
- [ ] Wire up UI visibility state
- [ ] Implement hide/show animations
- [ ] Test on mobile devices
- [ ] Test on desktop browsers
- [ ] Migrate old components
- [ ] Remove deprecated components
- [ ] Update tests

---

## Testing Checklist

### Functional Tests
- [ ] UI toggle works (hide/show)
- [ ] All bottom nav buttons functional
- [ ] Corner icons clickable
- [ ] Animations smooth (60fps)
- [ ] Theme switching works with new UI
- [ ] Mobile responsive
- [ ] Desktop layout correct

### Visual Tests
- [ ] Proper spacing and alignment
- [ ] Theme colors applied correctly
- [ ] Icons render properly
- [ ] Shadows and effects visible
- [ ] No visual glitches during animation

### Performance Tests
- [ ] 60fps maintained during animations
- [ ] No jank when hiding/showing UI
- [ ] Physics simulation unaffected
- [ ] Memory usage acceptable

---

## Accessibility Checklist

- [ ] ARIA labels on all buttons
- [ ] Keyboard navigation support
- [ ] Focus visible styles
- [ ] Screen reader announcements
- [ ] High contrast mode support
- [ ] Reduced motion support (`prefers-reduced-motion`)
- [ ] Touch target sizes (min 48px)

---

**Ready for Phase 2 Implementation**
Next Step: Create `src/components/layout/BottomNav.tsx`
