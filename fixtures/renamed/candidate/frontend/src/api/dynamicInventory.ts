export async function dynamicInventory(baseUrl: string, key: string) {
  // Runtime origin and path cannot be resolved from this snapshot.
  const response = await fetch(`${baseUrl}/${key}`);
  return response.json();
}
