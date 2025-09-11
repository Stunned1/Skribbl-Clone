/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  safelist: [
    'bg-green-50',
    'border-green-200',
    'text-green-800',
    'text-green-700',
    'bg-blue-100',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}

