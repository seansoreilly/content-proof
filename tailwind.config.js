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
        "primary-50": "#ffffff",
        "primary-100": "#fafafa",
        "primary-200": "#f5f5f5",
        "primary-300": "#eeeeee",
        "primary-400": "#e0e0e0",
        "primary-500": "#cccccc",

        // Accent Colours
        "accent-blue": "#2563eb",
        "accent-teal": "#2dd4bf",
        "accent-purple": "#7c3aed",
        "accent-pink": "#d946ef",

        // Light Greys
        "light-50": "#ffffff",
        "light-100": "#f9fafb",
        "light-200": "#f3f4f6",
        "light-300": "#e5e7eb",
        "light-400": "#d1d5db",
        "light-500": "#9ca3af",
        "light-600": "#6b7280",
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
