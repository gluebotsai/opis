import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type UIEvent,
} from "react";

import { cn } from "@/lib/utils";

/** Keep the thumb inside the flat area — clear rounded panel corners (rounded-2xl). */
const SCROLLBAR_INSET_TOP = 12;
const SCROLLBAR_INSET_BOTTOM = 20;
const SCROLLBAR_MIN_THUMB = 28;

type PanelScrollAreaProps = {
  children: ReactNode;
  className?: string;
  onScroll?: (event: UIEvent<HTMLDivElement>) => void;
  /** Place the custom scrollbar beside the scrollport (outside a nested card). */
  trackOutside?: boolean;
  /** Chrome around the scrollport when `trackOutside` is set. */
  frameClassName?: string;
};

export const PanelScrollArea = forwardRef<HTMLDivElement, PanelScrollAreaProps>(
  function PanelScrollArea(
    { children, className, onScroll, trackOutside = false, frameClassName },
    forwardedRef,
  ) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{
      pointerId: number;
      startY: number;
      startThumbTop: number;
      trackHeight: number;
      thumbHeight: number;
    } | null>(null);
    const [metrics, setMetrics] = useState({
      scrollable: false,
      thumbTop: 0,
      thumbHeight: 48,
      trackHeight: 0,
    });

    const setScrollRef = useCallback(
      (node: HTMLDivElement | null) => {
        scrollRef.current = node;
        if (typeof forwardedRef === "function") {
          forwardedRef(node);
        } else if (forwardedRef) {
          forwardedRef.current = node;
        }
      },
      [forwardedRef],
    );

    const scrollToThumbTop = useCallback((thumbTop: number, trackHeight: number, thumbHeight: number) => {
      const node = scrollRef.current;
      if (!node) return;
      const maxScroll = node.scrollHeight - node.clientHeight;
      const thumbTravel = Math.max(0, trackHeight - thumbHeight);
      if (maxScroll <= 0 || thumbTravel <= 0) {
        node.scrollTop = 0;
        return;
      }
      const clamped = Math.min(Math.max(thumbTop, 0), thumbTravel);
      node.scrollTop = (clamped / thumbTravel) * maxScroll;
    }, []);

    useEffect(() => {
      const el = scrollRef.current;
      if (!el) return;

      function measure() {
        const node = scrollRef.current;
        if (!node) return;

        const { scrollHeight, clientHeight, scrollTop } = node;
        const scrollable = scrollHeight > clientHeight + 1;
        const trackHeight = Math.max(
          0,
          clientHeight - SCROLLBAR_INSET_TOP - SCROLLBAR_INSET_BOTTOM,
        );
        const thumbHeight = scrollable
          ? Math.max(SCROLLBAR_MIN_THUMB, (clientHeight / scrollHeight) * trackHeight)
          : trackHeight;
        const maxScroll = scrollHeight - clientHeight;
        const thumbTravel = Math.max(0, trackHeight - thumbHeight);
        const thumbTop =
          scrollable && maxScroll > 0 ? (scrollTop / maxScroll) * thumbTravel : 0;

        setMetrics({ scrollable, thumbTop, thumbHeight, trackHeight });
      }

      measure();
      el.addEventListener("scroll", measure, { passive: true });
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      for (const child of el.children) {
        observer.observe(child);
        if (child instanceof HTMLImageElement && !child.complete) {
          child.addEventListener("load", measure, { once: true });
        }
      }

      return () => {
        el.removeEventListener("scroll", measure);
        for (const child of el.children) {
          if (child instanceof HTMLImageElement) {
            child.removeEventListener("load", measure);
          }
        }
        observer.disconnect();
      };
    }, [children]);

    const handleTrackPointerDown = useCallback(
      (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        const track = trackRef.current;
        if (!track) return;

        // Ignore if the event started on the thumb — thumb handler owns that drag.
        if ((event.target as HTMLElement | null)?.dataset.scrollThumb === "true") return;

        const rect = track.getBoundingClientRect();
        const clickY = event.clientY - rect.top;
        const nextThumbTop = clickY - metrics.thumbHeight / 2;
        scrollToThumbTop(nextThumbTop, metrics.trackHeight, metrics.thumbHeight);
      },
      [metrics.thumbHeight, metrics.trackHeight, scrollToThumbTop],
    );

    const handleThumbPointerDown = useCallback(
      (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();

        const thumb = event.currentTarget;
        thumb.setPointerCapture(event.pointerId);
        dragRef.current = {
          pointerId: event.pointerId,
          startY: event.clientY,
          startThumbTop: metrics.thumbTop,
          trackHeight: metrics.trackHeight,
          thumbHeight: metrics.thumbHeight,
        };
      },
      [metrics.thumbHeight, metrics.thumbTop, metrics.trackHeight],
    );

    const handleThumbPointerMove = useCallback(
      (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        event.preventDefault();
        const delta = event.clientY - drag.startY;
        scrollToThumbTop(
          drag.startThumbTop + delta,
          drag.trackHeight,
          drag.thumbHeight,
        );
      },
      [scrollToThumbTop],
    );

    const handleThumbPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }, []);

    const scrollport = (
      <div
        ref={setScrollRef}
        onScroll={onScroll}
        className={cn(
          "panel-scroll-native h-0 min-h-0 flex-1 overflow-y-auto overscroll-contain",
          className,
        )}
      >
        {children}
      </div>
    );

    return (
      <div
        className={cn(
          "relative flex h-0 min-h-0 flex-1",
          trackOutside ? "overflow-visible" : "flex-col overflow-hidden",
        )}
      >
        {trackOutside ? (
          <div
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
              frameClassName,
            )}
          >
            {scrollport}
          </div>
        ) : (
          scrollport
        )}

        {metrics.scrollable ? (
          <div
            ref={trackRef}
            aria-hidden
            data-export-ignore="true"
            className={cn(
              "absolute z-10 w-3 cursor-pointer",
              trackOutside ? "-right-3" : "right-0.5",
            )}
            style={{
              top: SCROLLBAR_INSET_TOP,
              bottom: SCROLLBAR_INSET_BOTTOM,
            }}
            onPointerDown={handleTrackPointerDown}
          >
            <div
              data-scroll-thumb="true"
              className="absolute left-1/2 w-1.5 -translate-x-1/2 cursor-grab rounded-full bg-neutral-300/90 active:cursor-grabbing"
              style={{
                height: metrics.thumbHeight,
                top: metrics.thumbTop,
                touchAction: "none",
              }}
              onPointerDown={handleThumbPointerDown}
              onPointerMove={handleThumbPointerMove}
              onPointerUp={handleThumbPointerUp}
              onPointerCancel={handleThumbPointerUp}
            />
          </div>
        ) : null}
      </div>
    );
  },
);
