// scripts/validate.js
export function validateConfig(cfg, requiredKeys, label = "TYPE_CONFIG") {
  if (!cfg) throw new Error(`${label} is missing`);
  for (const k of requiredKeys) {
    if (!cfg[k]) throw new Error(`${label} missing required key: ${k}`);
  }
}