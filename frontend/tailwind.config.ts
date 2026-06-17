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
          success: '#22d3a6',
          danger: '#ff718b',
          warning: '#f4c76b',
          accent: '#39d0ff',
          purple: '#a78bfa',
          blue: '#60a5fa',
        },
      },
      boxShadow: {
        panel: '0 22px 60px -36px rgba(0, 0, 0, 0.82)',
        glow: '0 0 0 1px rgba(57, 208, 255, 0.24), 0 20px 60px -36px rgba(57, 208, 255, 0.58)',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Roboto Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
