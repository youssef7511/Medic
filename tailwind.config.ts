import type { Config } from 'tailwindcss';

/**
 * §9: RTL discipline. We author with logical properties only (ms-*, me-*,
 * ps-*, pe-*, text-start/end). The eslint-plugin-tailwindcss config bans the
 * physical variants (ml-*, mr-*, pl-*, pr-*, text-left/right) so a stray
 * left/right can't slip in and break Arabic layout.
 */
const config: Config = {
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/features/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // Latin + a proper Arabic face (§9). Wired to CSS vars set per-locale.
        sans: ['var(--font-latin)', 'var(--font-arabic)', 'system-ui', 'sans-serif'],
        arabic: ['var(--font-arabic)', 'sans-serif'],
      },
      colors: {
        // Placeholder brand ramp — replace with the real palette.
        brand: {
          50: '#eef6ff',
          100: '#d9ecff',
          500: '#2f7cf6',
          600: '#1f63d6',
          700: '#1a4fac',
        },
      },
    },
  },
  plugins: [],
};

export default config;
