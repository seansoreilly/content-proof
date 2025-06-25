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
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      colors: {
        // Enhanced Primary Palette
        "primary-50": "#f8fafc",
        "primary-100": "#f1f5f9",
        "primary-200": "#e2e8f0",
        "primary-300": "#cbd5e1",
        "primary-400": "#94a3b8",
        "primary-500": "#64748b",
        "primary-600": "#475569",
        "primary-700": "#334155",
        "primary-800": "#1e293b",
        "primary-900": "#0f172a",

        // Enhanced Brand Colors
        "brand-blue": "#3b82f6",
        "brand-purple": "#8b5cf6",
        "brand-teal": "#06b6d4",
        "brand-emerald": "#10b981",
        "brand-pink": "#ec4899",

        // Accent Colors (keeping for backward compatibility)
        "accent-blue": "#2563eb",
        "accent-teal": "#2dd4bf",
        "accent-purple": "#7c3aed",
        "accent-pink": "#d946ef",

        // Semantic Colors
        success: "#10b981",
        warning: "#f59e0b",
        error: "#ef4444",
        info: "#3b82f6",

        // Light Blues (enhanced)
        "light-blue-50": "#eff6ff",
        "light-blue-100": "#dbeafe",
        "light-blue-200": "#bfdbfe",
        "light-blue-300": "#93c5fd",
        "light-blue-400": "#60a5fa",
        "light-blue-500": "#3b82f6",
        "light-blue-600": "#2563eb",

        // Dark Blues (enhanced)
        "dark-blue-50": "#1e293b",
        "dark-blue-100": "#334155",
        "dark-blue-200": "#475569",
        "dark-blue-300": "#64748b",
        "dark-blue-400": "#94a3b8",
        "dark-blue-500": "#cbd5e1",

        // Light Greys (enhanced)
        "light-50": "#f8fafc",
        "light-100": "#f1f5f9",
        "light-200": "#e2e8f0",
        "light-300": "#cbd5e1",
        "light-400": "#94a3b8",
        "light-500": "#64748b",
        "light-600": "#475569",
      },
      spacing: {
        18: "4.5rem",
        88: "22rem",
        128: "32rem",
      },
      borderRadius: {
        "4xl": "2rem",
        "5xl": "2.5rem",
      },
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "0.75rem" }],
        "3xl": ["1.875rem", { lineHeight: "2.25rem" }],
        "4xl": ["2.25rem", { lineHeight: "2.5rem" }],
        "5xl": ["3rem", { lineHeight: "1.2" }],
        "6xl": ["3.75rem", { lineHeight: "1.1" }],
        "7xl": ["4.5rem", { lineHeight: "1" }],
        "8xl": ["6rem", { lineHeight: "1" }],
        "9xl": ["8rem", { lineHeight: "1" }],
      },
      keyframes: {
        float: {
          "0%, 100%": {
            transform: "translateY(0) rotate(0deg)",
          },
          "50%": {
            transform: "translateY(-20px) rotate(5deg)",
          },
        },
        "pulse-slow": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        "pulse-glow": {
          "0%, 100%": {
            boxShadow: "0 0 20px rgba(59, 130, 246, 0.4)",
          },
          "50%": {
            boxShadow: "0 0 40px rgba(139, 92, 246, 0.6)",
          },
        },
        shimmer: {
          "0%": {
            backgroundPosition: "-200% 0",
          },
          "100%": {
            backgroundPosition: "200% 0",
          },
        },
        "fade-in": {
          "0%": {
            opacity: "0",
            transform: "translateY(10px)",
          },
          "100%": {
            opacity: "1",
            transform: "translateY(0)",
          },
        },
        "slide-up": {
          "0%": {
            opacity: "0",
            transform: "translateY(20px)",
          },
          "100%": {
            opacity: "1",
            transform: "translateY(0)",
          },
        },
        "scale-in": {
          "0%": {
            opacity: "0",
            transform: "scale(0.95)",
          },
          "100%": {
            opacity: "1",
            transform: "scale(1)",
          },
        },
      },
      animation: {
        float: "float 8s ease-in-out infinite",
        "pulse-slow": "pulse-slow 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "pulse-glow": "pulse-glow 3s ease-in-out infinite",
        shimmer: "shimmer 2s infinite",
        "fade-in": "fade-in 0.5s ease-out",
        "slide-up": "slide-up 0.5s ease-out",
        "scale-in": "scale-in 0.3s ease-out",
      },
      boxShadow: {
        glass: "0 8px 32px rgba(0,0,0,0.1)",
        "glass-lg": "0 12px 40px rgba(0,0,0,0.15)",
        glow: "0 0 20px rgba(59, 130, 246, 0.4)",
        "glow-lg": "0 0 40px rgba(139, 92, 246, 0.6)",
        "inner-glow": "inset 0 1px 0 rgba(255, 255, 255, 0.4)",
      },
      backdropBlur: {
        xs: "2px",
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
      animation: {
        "spin-slow": "spin 3s linear infinite",
        "bounce-slow": "bounce 3s infinite",
      },
      transitionTimingFunction: {
        smooth: "cubic-bezier(0.4, 0, 0.2, 1)",
        bouncy: "cubic-bezier(0.68, -0.55, 0.265, 1.55)",
      },
      scale: {
        102: "1.02",
        103: "1.03",
        98: "0.98",
      },
    },
  },
  plugins: [
    require("@tailwindcss/typography"),
    function ({ addUtilities }) {
      const newUtilities = {
        ".animation-delay-75": {
          "animation-delay": "75ms",
        },
        ".animation-delay-100": {
          "animation-delay": "100ms",
        },
        ".animation-delay-150": {
          "animation-delay": "150ms",
        },
        ".animation-delay-200": {
          "animation-delay": "200ms",
        },
        ".animation-delay-300": {
          "animation-delay": "300ms",
        },
        ".animation-delay-500": {
          "animation-delay": "500ms",
        },
        ".animation-delay-700": {
          "animation-delay": "700ms",
        },
        ".animation-delay-1000": {
          "animation-delay": "1000ms",
        },
      };
      addUtilities(newUtilities, ["responsive", "hover"]);
    },
  ],
};
