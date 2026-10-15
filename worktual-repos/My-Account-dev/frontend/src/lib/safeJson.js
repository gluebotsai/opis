function isDomNode(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  const name = value.constructor?.name || "";
  return (
    name.endsWith("Element") ||
    name === "HTMLButtonElement" ||
    name === "HTMLInputElement" ||
    typeof value.nodeType === "number"
  );
}

function isReactInternalKey(key) {
  return key === "nativeEvent" || key.startsWith("__reactFiber") || key.startsWith("__reactProps");
}

export function safeStringify(value) {
  const seen = new WeakSet();

  return JSON.stringify(value, (key, current) => {
    if (isReactInternalKey(key)) {
      return undefined;
    }

    if (typeof current === "function") {
      return undefined;
    }

    if (isDomNode(current)) {
      return undefined;
    }

    if (typeof current === "object" && current !== null) {
      if (seen.has(current)) {
        return undefined;
      }
      seen.add(current);
    }

    return current;
  });
}
