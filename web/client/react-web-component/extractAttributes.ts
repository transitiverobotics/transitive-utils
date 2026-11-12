/*
 * Takes in a node attributes map and returns an object with camelCased
 * properties and values
 * @param nodeMap
 * @returns {{}}
 */
export default function extractAttributes(
  nodeMap: { attributes?: NamedNodeMap | null }
): Record<string, string> {
  if (!nodeMap.attributes) {
    return {};
  }

  const obj: Record<string, string> = {};
  let attribute;
  const attributesAsNodeMap = [...nodeMap.attributes];
  const attributes = attributesAsNodeMap.map((attribute) =>
    ({ [attribute.name]: attribute.value }));

  for (attribute of attributes) {
    const key = Object.keys(attribute)[0];
    const camelCasedKey = key.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
    obj[camelCasedKey] = attribute[key];
  }

  return obj;
};
