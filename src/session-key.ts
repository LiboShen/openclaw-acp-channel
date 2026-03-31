export function buildOpenClawSessionKey(routeSessionKey: string, acpSessionId?: string): string {
  const base = routeSessionKey.trim();
  if (!acpSessionId?.trim()) return base;
  return `${base}:acp:${acpSessionId.trim().toLowerCase()}`;
}
