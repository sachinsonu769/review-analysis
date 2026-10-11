import { externalLookup } from './missingClient';

export function useMissingDependency() {
  return externalLookup();
}
