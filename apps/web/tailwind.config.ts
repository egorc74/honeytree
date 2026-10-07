import type { Config } from "tailwindcss";
import honeyPreset from "@honeytree/ui-tokens/tailwind-preset";

const config: Config = {
  presets: [honeyPreset as Config],
  content: ["./src/**/*.{ts,tsx}"],
};

export default config;
