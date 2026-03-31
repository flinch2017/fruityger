const THEME_STORAGE_KEY = "appearanceTheme";

export const getStoredTheme = () => localStorage.getItem(THEME_STORAGE_KEY) || "light";

export const applyTheme = (theme) => {
  const resolvedTheme = theme === "dark" ? "dark" : "light";
  localStorage.setItem(THEME_STORAGE_KEY, resolvedTheme);
  document.body.dataset.theme = resolvedTheme;
  document.documentElement.dataset.theme = resolvedTheme;
};
