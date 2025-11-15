/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Theme-aware colors using CSS variables
      colors: {
        'theme-primary': 'var(--color-primary)',
        'theme-secondary': 'var(--color-secondary)',
        'theme-accent': 'var(--color-accent)',
        'theme-bg': 'var(--color-background)',
        'theme-surface': 'var(--color-surface)',
        'theme-text': 'var(--color-text-primary)',
        'theme-text-secondary': 'var(--color-text-secondary)',
        'theme-text-muted': 'var(--color-text-muted)',
        'theme-dice-highlight': 'var(--color-dice-highlight)',
        'theme-dice-shadow': 'var(--color-dice-shadow)',
      },

      // Theme-aware typography
      fontFamily: {
        'theme-primary': 'var(--font-family-primary)',
        'theme-mono': 'var(--font-family-mono)',
      },
      fontSize: {
        'theme-xs': 'var(--font-size-xs)',
        'theme-sm': 'var(--font-size-sm)',
        'theme-base': 'var(--font-size-base)',
        'theme-lg': 'var(--font-size-lg)',
        'theme-xl': 'var(--font-size-xl)',
        'theme-2xl': 'var(--font-size-2xl)',
        'theme-3xl': 'var(--font-size-3xl)',
      },
      fontWeight: {
        'theme-normal': 'var(--font-weight-normal)',
        'theme-medium': 'var(--font-weight-medium)',
        'theme-semibold': 'var(--font-weight-semibold)',
        'theme-bold': 'var(--font-weight-bold)',
      },

      // Theme-aware spacing
      spacing: {
        'theme-unit': 'var(--spacing-unit)',
      },

      // Theme-aware border radius
      borderRadius: {
        'theme-sm': 'var(--border-radius-sm)',
        'theme-md': 'var(--border-radius-md)',
        'theme-lg': 'var(--border-radius-lg)',
        'theme-full': 'var(--border-radius-full)',
      },

      // Theme-aware shadows
      boxShadow: {
        'theme-sm': 'var(--shadow-sm)',
        'theme-md': 'var(--shadow-md)',
        'theme-lg': 'var(--shadow-lg)',
      },

      // Theme-aware gradients (use with bg-gradient-to-*)
      backgroundImage: {
        'theme-gradient-primary': 'var(--gradient-primary)',
        'theme-gradient-secondary': 'var(--gradient-secondary)',
      },
    },
  },
  plugins: [],
}
