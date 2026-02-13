import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        primary: "#135bec",
        "background-light": "#f6f6f8",
        "background-dark": "#101622",
        ink: {
          50: "#f7f4f1",
          100: "#efe9e3",
          200: "#dccdc0",
          300: "#c7b0a1",
          400: "#b29382",
          500: "#9b7766",
          600: "#7f5f52",
          700: "#654b41",
          800: "#4b3630",
          900: "#332521"
        },
        mist: {
          50: "#f8fafb",
          100: "#eef3f5",
          200: "#d9e2e7",
          300: "#c2cfd8",
          400: "#a6b8c5",
          500: "#8aa2b1",
          600: "#708696",
          700: "#5a6b7a",
          800: "#44505c",
          900: "#2f383e"
        },
        accent: {
          500: "#f27348",
          600: "#d85d36"
        }
      },
      fontFamily: {
        display: ["Inter", "var(--font-body)", "sans-serif"]
      },
      boxShadow: {
        card: "0 10px 30px rgba(43, 32, 26, 0.15)"
      }
    }
  },
  plugins: []
};

export default config;
