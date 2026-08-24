export interface IdentityPreference {
  displayId: string | null;
  showIdentityDefault: boolean;
}

export function resolvePublicUploader(
  preference: IdentityPreference,
  perVideoOverride?: boolean,
): string | null {
  const visible = perVideoOverride ?? preference.showIdentityDefault;
  return visible && preference.displayId ? preference.displayId : null;
}
