/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx}",
    "./src/pages/**/*.{js,ts,jsx,tsx}",
    "./src/components/**/*.{js,ts,jsx,tsx}",
    "./documentation/**/*.{md,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Primary Off-Whites
        "primary-50": "#f5f5f5",
        "primary-100": "#e8e8e8",
        "primary-200": "#d8d8d8",
        "primary-300": "#c8c8c8",
        "primary-400": "#b8b8b8",
        "primary-500": "#a8a8a8",

        // Accent Colours
        "accent-blue": "#2563eb",
        "accent-teal": "#2dd4bf",
        "accent-purple": "#7c3aed",
        "accent-pink": "#d946ef",

        // Light Blues
        "light-blue-50": "#e0f2fe",
        "light-blue-100": "#bae6fd",
        "light-blue-200": "#7dd3fc",
        "light-blue-300": "#38bdf8",
        "light-blue-400": "#0ea5e9",
        "light-blue-500": "#0284c7",

        // Dark Blues
        "dark-blue-50": "#172554",
        "dark-blue-100": "#1e3a8a",
        "dark-blue-200": "#1e40af",
        "dark-blue-300": "#1d4ed8",
        "dark-blue-400": "#2563eb",
        "dark-blue-500": "#3b82f6",

        // Light Greys
        "light-50": "#f3f4f6",
        "light-100": "#e5e7eb",
        "light-200": "#d1d5db",
        "light-300": "#9ca3af",
        "light-400": "#6b7280",
        "light-500": "#4b5563",
        "light-600": "#374151",
      },
      backdropBlur: {
        xs: "2px",
        sm: "4px",
        md: "8px",
        lg: "12px",
        xl: "16px",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        glow: {
          "0%": { filter: "drop-shadow(0 0 4px rgba(255,255,255,0.3))" },
          "100%": { filter: "drop-shadow(0 0 8px rgba(255,255,255,0.6))" },
        },
        "pulse-slow": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        "gradient-x": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
      },
      animation: {
        float: "float 6s ease-in-out infinite",
        glow: "glow 2s ease-in-out infinite alternate",
        "pulse-slow": "pulse-slow 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "gradient-x": "gradient-x 15s ease infinite",
      },
      boxShadow: {
        glass: "0 4px 20px rgba(0,0,0,0.1)",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
