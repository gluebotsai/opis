import { useEffect, type RefObject } from "react";

const PIN_THRESHOLD_PX = 80;

export function useChatAutoScroll(
  scrollRef: RefObject<HTMLDivElement | null>,
  ...triggers: unknown[]
) {
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let pinned = true;

    function isNearBottom(node: HTMLDivElement) {
      return node.scrollHeight - node.scrollTop - node.clientHeight < PIN_THRESHOLD_PX;
    }

    function scrollToEnd() {
      const node = scrollRef.current;
      if (!node) return;
      node.scrollTop = node.scrollHeight;
    }

    function handleScroll() {
      const node = scrollRef.current;
      if (!node) return;
      pinned = isNearBottom(node);
    }

    function keepPinned() {
      if (pinned) scrollToEnd();
    }

    el.addEventListener("scroll", handleScroll, { passive: true });

    scrollToEnd();
    const raf = requestAnimationFrame(scrollToEnd);
    const t1 = window.setTimeout(scrollToEnd, 50);
    const t2 = window.setTimeout(scrollToEnd, 350);

    const viewportObserver = new ResizeObserver(keepPinned);
    viewportObserver.observe(el);

    const content = el.firstElementChild;
    const contentObserver = content ? new ResizeObserver(keepPinned) : null;
    if (content && contentObserver) {
      contentObserver.observe(content);
    }

    return () => {
      el.removeEventListener("scroll", handleScroll);
      cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      viewportObserver.disconnect();
      contentObserver?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- explicit scroll triggers only
  }, [scrollRef, ...triggers]);
}
