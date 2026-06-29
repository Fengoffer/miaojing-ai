export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.COZE_PROJECT_ENV === 'PROD';
}

export function getRequiredProductionSecret(name: string, developmentFallback: string): string {
  const value = process.env[name];
  if (value) return value;
  if (isProductionRuntime()) {
    throw new Error(`${name} is required in production`);
  }
  return developmentFallback;
}
