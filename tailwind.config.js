/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        midnight: '#0f172a',
        neon: '#22d3ee',
        success: '#22c55e',
      },
      boxShadow: {
        glow: '0 0 30px rgba(34, 211, 238, 0.35)',
        glowStrong: '0 0 50px rgba(34, 197, 94, 0.65)',
      },
      keyframes: {
        pulseRing: {
          '0%': { transform: 'scale(1)', opacity: '0.95' },
          '60%': { transform: 'scale(1.35)', opacity: '0' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
        listeningPulse: {
          '0%': { transform: 'scale(1)', boxShadow: '0 0 12px rgba(34,211,238,0.25)' },
          '50%': { transform: 'scale(1.05)', boxShadow: '0 0 24px rgba(34,211,238,0.4)' },
          '100%': { transform: 'scale(1)', boxShadow: '0 0 12px rgba(34,211,238,0.25)' },
        },
      },
      animation: {
        pulseRing: 'pulseRing 1.6s ease-out infinite',
        listeningPulse: 'listeningPulse 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
