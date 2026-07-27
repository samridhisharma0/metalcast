/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // surfaces
        base: 'var(--c-base)',
        panel: 'var(--c-panel)',
        raised: 'var(--c-raised)',
        line: 'var(--c-line)',
        lineSoft: 'var(--c-line-soft)',
        // text
        ink: 'var(--c-ink)',
        muted: 'var(--c-muted)',
        faint: 'var(--c-faint)',
        // brand: oxidised copper patina
        patina: {
          DEFAULT: 'var(--c-patina)',
          deep: 'var(--c-patina-deep)',
          wash: 'var(--c-patina-wash)',
        },
        copper: 'var(--c-copper)',
        aluminium: 'var(--c-aluminium)',
        up: 'var(--c-up)',
        down: 'var(--c-down)',
        amber: 'var(--c-amber)',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.06em' }],
        tape: ['clamp(2.25rem, 6vw, 4rem)', { lineHeight: '1', letterSpacing: '-0.03em' }],
      },
      borderRadius: { xl: '0.625rem', '2xl': '0.875rem' },
      boxShadow: {
        panel: '0 1px 0 0 var(--c-line) inset, 0 12px 32px -20px rgba(0,0,0,0.7)',
        lift: '0 18px 40px -24px rgba(0,0,0,0.75)',
        glow: '0 0 0 1px var(--c-patina-deep), 0 0 28px -8px var(--c-patina-wash)',
      },
      keyframes: {
        'flash-up': { '0%': { backgroundColor: 'var(--c-up-wash)' }, '100%': { backgroundColor: 'transparent' } },
        'flash-down': { '0%': { backgroundColor: 'var(--c-down-wash)' }, '100%': { backgroundColor: 'transparent' } },
        'slide-up': { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'none' } },
        'ring-pulse': {
          '0%': { transform: 'scale(0.85)', opacity: 0.9 },
          '70%': { transform: 'scale(1.7)', opacity: 0 },
          '100%': { transform: 'scale(1.7)', opacity: 0 },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'draw-in': { from: { strokeDashoffset: '1000' }, to: { strokeDashoffset: '0' } },
      },
      animation: {
        'flash-up': 'flash-up 900ms ease-out',
        'flash-down': 'flash-down 900ms ease-out',
        'slide-up': 'slide-up 340ms cubic-bezier(0.22,1,0.36,1) both',
        'ring-pulse': 'ring-pulse 2.4s ease-out infinite',
        shimmer: 'shimmer 1.6s infinite',
      },
      transitionTimingFunction: { spring: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    },
  },
  plugins: [],
}
