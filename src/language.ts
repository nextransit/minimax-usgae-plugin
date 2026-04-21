export type LanguagePreference = "auto" | "zh-CN" | "en";
export type UiLanguage = "zh-CN" | "en";

export function resolveUiLanguageFromPreference(
  preference: LanguagePreference,
  envLanguage: string,
): UiLanguage {
  if (preference === "zh-CN" || preference === "en") {
    return preference;
  }

  return envLanguage.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function getNextLanguagePreference(
  preference: LanguagePreference,
  envLanguage: string,
): UiLanguage {
  return resolveUiLanguageFromPreference(preference, envLanguage) === "en" ? "zh-CN" : "en";
}
