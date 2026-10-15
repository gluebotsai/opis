import { useEffect, useRef, useState } from "react";

export function useInfiniteScroll({
  hasMore,
  loading,
  onLoadMore,
  rootMargin = "240px",
  scrollRoot = null,
}: {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  rootMargin?: string;
  /** When set, load-more triggers when the sentinel enters this element (not the viewport). */
  scrollRoot?: Element | null;
}) {
  const loadingRef = useRef(loading);
  const hasMoreRef = useRef(hasMore);
  const onLoadMoreRef = useRef(onLoadMore);

  loadingRef.current = loading;
  hasMoreRef.current = hasMore;
  onLoadMoreRef.current = onLoadMore;

  // Callback ref so we observe after the sentinel mounts (e.g. after a skeleton).
  const [node, setNode] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (!hasMoreRef.current || loadingRef.current) return;
        onLoadMoreRef.current();
      },
      { root: scrollRoot, rootMargin, threshold: 0 },
    );
    observer.observe(node);

    return () => observer.disconnect();
  }, [node, rootMargin, loading, hasMore, scrollRoot]);

  return setNode;
}
