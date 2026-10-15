function isReactInternalKey(key: any) {
  return key === "nativeEvent" || key.startsWith("__reactFiber") || key.startsWith("__reactProps");
}

export function safeStringify(value: any) {
  const seen = new WeakSet();

  return JSON.stringify(value, (key: any, current: any) => {
    if (isReactInternalKey(key)) {
      return undefined;
    }

    if (typeof current === "function") {
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
