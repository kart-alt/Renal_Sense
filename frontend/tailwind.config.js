/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        clinical: {
          50: '#f0f7f7',
          100: '#dbebeb',
          200: '#bcd7d7',
          500: '#008b8b', // Dark cyan clinical primary
          600: '#007575',
          700: '#005e5e',
          900: '#062d2d'
        }
      }
    },
  },
  plugins: [],
}
