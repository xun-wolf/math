import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          500: "#2f6feb",
          700: "#1e4bb5",
        },
      },
    },
  },
  plugins: [],
};
export default config;
