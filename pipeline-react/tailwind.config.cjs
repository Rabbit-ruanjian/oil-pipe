/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 8px 30px rgba(15, 23, 42, 0.08)',
        glass: '0 20px 60px rgba(15, 23, 42, 0.12)',
      },
      backgroundImage: {
        'mesh-light':
          'radial-gradient(circle at 0% 0%, rgba(59,130,246,0.14), transparent 38%), radial-gradient(circle at 100% 100%, rgba(99,102,241,0.14), transparent 40%)',
      },
    },
  },
  plugins: [],
};
