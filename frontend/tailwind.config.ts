import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        odds: {
          bg: 'rgb(var(--odds-bg) / <alpha-value>)',
          panel: 'rgb(var(--odds-panel) / <alpha-value>)',
          panel2: 'rgb(var(--odds-panel2) / <alpha-value>)',
          border: 'rgb(var(--odds-border) / <alpha-value>)',
          muted: 'rgb(var(--odds-muted) / <alpha-value>)',
          text: 'rgb(var(--odds-text) / <alpha-value>)',
          text2: 'rgb(var(--odds-text2) / <alpha-value>)',
          text3: 'rgb(var(--odds-text3) / <alpha-value>)',
          control: 'rgb(var(--odds-control) / <alpha-value>)',
          grid: 'rgb(var(--odds-grid) / <alpha-value>)',
          success: '#22c987',
          danger: '#f05252',
          warning: '#f3c24b',
          accent: '#38bdf8',
        },
      },
      boxShadow: {
        panel: '0 20px 60px -34px rgba(0, 0, 0, 0.72)',
        glow: '0 0 0 1px rgba(34, 201, 135, 0.28), 0 20px 60px -36px rgba(34, 201, 135, 0.56)',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Roboto Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
