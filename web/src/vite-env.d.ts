/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_DEFAULT_MODE?: "live" | "demo" | "auto";
  /** Set by the GitHub Pages build: the page is hosted, the analysis server runs on the user's PC. */
  readonly VITE_HOSTED?: string;
  readonly VITE_REPO_URL?: string;
}
