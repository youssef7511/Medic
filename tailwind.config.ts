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
        navy: {
          50: '#f2f6fa',
          100: '#dfe8f1',
          800: '#173655',
          900: '#0d2945',
          950: '#071d36',
        },
        brand: {
          50: '#ecfdfc',
          100: '#cffaf7',
          200: '#9bf4ef',
          300: '#5be6e1',
          400: '#25ceca',
          500: '#0eaaa9',
          600: '#078889',
          700: '#096c6e',
          800: '#0d5759',
          900: '#10494a',
        },
      },
      boxShadow: {
        card: '0 12px 35px -20px rgba(7, 29, 54, 0.28)',
      },
    },
  },
  plugins: [],
};

export default config;
