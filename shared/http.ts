export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, "");
}

export function sanitizeApiKey(apiKey: string): string {
  return sanitizeHeaderValue(apiKey);
}
