export async function dynamicLookup(baseUrl: string, key: string) {
  // Runtime origin and path cannot be resolved from this snapshot.
  const response = await fetch(`${baseUrl}/${key}`);
  return response.json();
}
