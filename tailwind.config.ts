import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.ts"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      colors: {
        // Sistema visual (C7 · RECONSTRUCCION_VISUAL.md §5): colores con significado, no por pantalla
        surface: "#f7f7fb",
        canvas: "#f7f7fb",
        ink: "#0f172a",
        muted: "#64748b",
        ok: colors.emerald,
        warn: colors.amber,
        danger: colors.rose,
        info: colors.sky,
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px -12px rgba(15, 23, 42, 0.12)",
        float: "0 12px 40px -12px rgba(79, 70, 229, 0.45)",
      },
    },
  },
  plugins: [],
};
export default config;
