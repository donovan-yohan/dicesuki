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
        'theme-accent': 'var(--color-accent)',
        // Label colour for anything sitting ON an accent fill. Use
        // `text-theme-on-accent` with `bg-theme-accent` — never `text-white`
        // or `text-theme-primary`, which are not guaranteed to read on it.
        'theme-on-accent': 'var(--color-on-accent)',
        'theme-bg': 'var(--color-background)',
        'theme-surface': 'var(--color-surface)',
        'theme-text': 'var(--color-text-primary)',
        'theme-text-secondary': 'var(--color-text-secondary)',
        'theme-text-muted': 'var(--color-text-muted)',
      },
    },
  },
  plugins: [],
}
