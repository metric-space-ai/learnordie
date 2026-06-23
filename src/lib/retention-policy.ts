import policy from "../../config/retention-policy.json";

export type RetentionPolicy = typeof policy;

export const retentionPolicy: RetentionPolicy = policy;

export function resolvedRetentionPolicy(years: number, cutoffAt: string, asOf: string) {
  return {
    ...retentionPolicy,
    years,
    cutoffAt,
    asOf,
    pseudonymousLearningSignals: {
      ...retentionPolicy.pseudonymousLearningSignals,
      years
    }
  };
}
