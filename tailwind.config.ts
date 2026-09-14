import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F2F0E8",
        ink: "#1B1B1D",
        line: "#D9D5C7",
        muted: "#6B6759",
        status: {
          green: "#2F5233",
          greenSoft: "#E4EBE1",
          orange: "#C98A2B",
          orangeSoft: "#F6E9D3",
          red: "#B33A2E",
          redSoft: "#F5E1DD",
        },
      },
      fontFamily: {
        serif: ["'Source Serif 4'", "Georgia", "serif"],
        sans: ["'Inter'", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "monospace"],
      },
      borderRadius: {
        card: "6px",
      },
    },
  },
  plugins: [],
};

export default config;
