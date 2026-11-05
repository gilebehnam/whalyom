// Shared spawn environment for tests: OM_NO_DOTENV=1 stops every spawned tool's loadEnv() from refilling
// stripped or blanked connector keys from the repo .env, so `npm test` never reaches a real connector.
export const testEnv = (base = process.env, extra = {}) => ({ ...base, OM_NO_DOTENV: '1', ...extra });
