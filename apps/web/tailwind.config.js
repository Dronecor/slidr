/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        ink: "#1a1d21",
        paper: "#ffffff",
        spot: "#f5a623",
        moss: "#2f5d50",
      },
      boxShadow: {
        hard: "5px 5px 0 0 #1a1d21",
        "hard-sm": "3px 3px 0 0 #1a1d21",
        none: "none",
      },
    },
  },
  plugins: [],
};
