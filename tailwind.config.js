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
        paper: "var(--paper)",
        relief: "var(--relief)",
        "relief-hi": "var(--relief-hi)",
        ink: "var(--ink)",
        mute: "var(--mute)",
        accent: "var(--accent)",
        tint: "var(--tint)",
        void: "var(--void)",
      },
      boxShadow: {
        panel:
          "inset 1px 1px 2px var(--relief-hi), inset -2px -2px 4px var(--relief)",
        pressed:
          "inset -1px -1px 2px var(--relief-hi), inset 2px 2px 4px var(--relief)",
        raised:
          "inset 1px 1px 2px var(--relief-hi), inset -2px -2px 4px var(--relief), 6px 8px 18px -8px var(--relief)",
        outline: "inset 0 0 0 1.5px var(--accent)",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "Georgia", "serif"],
        sans: ["var(--font-body)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
