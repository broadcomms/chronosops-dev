/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // OODA phase colors
        observe: {
          DEFAULT: '#3B82F6', // blue
          light: '#93C5FD',
          dark: '#1D4ED8',
        },
        orient: {
          DEFAULT: '#8B5CF6', // violet
          light: '#C4B5FD',
          dark: '#6D28D9',
        },
        decide: {
          DEFAULT: '#F59E0B', // amber
          light: '#FCD34D',
          dark: '#D97706',
        },
        act: {
          DEFAULT: '#10B981', // emerald
          light: '#6EE7B7',
          dark: '#059669',
        },
        verify: {
          DEFAULT: '#06B6D4', // cyan
          light: '#67E8F9',
          dark: '#0891B2',
        },
      },
    },
  },
  plugins: [],
};
