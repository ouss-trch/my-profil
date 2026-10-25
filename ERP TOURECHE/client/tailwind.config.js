const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: { sans: ['"IBM Plex Sans Arabic"', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'] },
      colors: {
        page: v('page'),
        surface: v('surface'),
        raised: v('raised'),
        line: v('line'),
        ink: v('ink'),
        sub: v('sub'),
        muted: v('muted'),
        brand: { DEFAULT: v('brand'), soft: v('brand-soft'), ink: v('brand-ink') },
        good: v('good'),
        warn: v('warn'),
        bad: v('bad'),
        info: v('info'),
      },
      boxShadow: { card: '0 1px 2px rgb(0 0 0 / 0.06), 0 1px 1px rgb(0 0 0 / 0.04)', pop: '0 12px 32px -8px rgb(0 0 0 / 0.35)' },
      borderRadius: { xl: '0.85rem' },
    },
  },
  plugins: [],
};
