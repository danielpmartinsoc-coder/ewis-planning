/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', 'monospace'],
        sans: ['"DM Sans"', 'sans-serif'],
      },
      colors: {
        bg:       '#F4F6FB',
        surface:  '#FFFFFF',
        surface2: '#EEF1F8',
        surface3: '#E4E8F2',
        border:   '#D0D7E8',
        text:     '#1A2535',
        dim:      '#7A8BA8',
        mid:      '#4A5B78',
        ok:       '#0A8F5C',
        risk:     '#C97500',
        blocked:  '#C82020',
        done:     '#1D6FE8',
        accent:   '#0782B0',
        delivered:'#7B4ECC',
      },
      boxShadow: {
        card: '0 1px 3px rgba(26,37,53,0.06), 0 1px 2px rgba(26,37,53,0.04)',
        'card-md': '0 4px 12px rgba(26,37,53,0.08)',
      },
    },
  },
  plugins: [],
}
