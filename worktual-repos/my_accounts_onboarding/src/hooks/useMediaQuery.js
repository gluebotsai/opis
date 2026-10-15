import { useEffect, useState } from "react";

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const media = window.matchMedia(query);
    function onChange(event) {
      setMatches(event.matches);
    }
    media.addEventListener("change", onChange);
    setMatches(media.matches);
    return () => media.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
