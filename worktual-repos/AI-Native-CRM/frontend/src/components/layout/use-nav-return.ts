import { useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import {
  elementAtScrollPath,
  locationHref,
  markOpenWorkspace,
  navModuleKey,
  noteNavigation,
  readFocus,
  readScroll,
  rememberModuleHref,
  scrollPath,
  writeFocus,
  writeScroll,
  type ScrollNode,
} from "@/lib/nav-return";
import { setCoworkerExpand, useAppDispatch, useAppSelector } from "@/store";

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

function workspaceRoot(): HTMLElement | null {
  const node = document.querySelector("[data-workspace-scroll]");
  return node instanceof HTMLElement ? node : null;
}

function asScrollNode(node: HTMLElement): ScrollNode {
  return node as unknown as ScrollNode;
}

/**
 * Restores the last URL, scroll, and selected row when a module is opened
 * again, and folds a maximized chat back when the module changes.
 */
export function useNavReturn() {
  const { pathname, search, hash, key } = useLocation();
  const navigationType = useNavigationType();
  const dispatch = useAppDispatch();
  const expand = useAppSelector((s) => s.shell.coworkerExpand);
  const href = locationHref(pathname, search, hash);
  const moduleKey = navModuleKey(pathname);
  const moduleRef = useRef(moduleKey);
  const scrollsRef = useRef<Record<string, number>>({});
  const shouldCollapse =
    moduleRef.current !== moduleKey && (expand === "chat" || expand === "chatFull");
  if (shouldCollapse) markOpenWorkspace();

  useLayoutEffect(() => {
    const changed = moduleRef.current !== moduleKey;
    moduleRef.current = moduleKey;
    if (changed && (expand === "chat" || expand === "chatFull")) {
      dispatch(setCoworkerExpand("default"));
    }
  }, [moduleKey, expand, dispatch]);

  useLayoutEffect(() => {
    rememberModuleHref(pathname, href);
    noteNavigation(href, navigationType);
  }, [pathname, href, navigationType, key]);

  useLayoutEffect(() => {
    scrollsRef.current = {};
    let timer = 0;
    const flush = () => {
      writeScroll(href, scrollsRef.current);
    };
    const onScroll = (event: Event) => {
      const node = event.target;
      const root = workspaceRoot();
      if (!(node instanceof HTMLElement) || !root) return;
      if (node !== root && !root.contains(node)) return;
      const overflow = getComputedStyle(node).overflowY;
      if (
        node !== root &&
        overflow !== "auto" &&
        overflow !== "scroll" &&
        overflow !== "overlay"
      ) {
        return;
      }
      scrollsRef.current[scrollPath(asScrollNode(node), asScrollNode(root))] = node.scrollTop;
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, 80);
    };
    const onFocus = (event: MouseEvent) => {
      const node = event.target;
      if (!(node instanceof Element)) return;
      const marked = node.closest("[data-return-focus]");
      const id = marked?.getAttribute("data-return-focus");
      if (id) writeFocus(href, id);
    };
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("click", onFocus, true);
    return () => {
      window.clearTimeout(timer);
      flush();
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("click", onFocus, true);
    };
  }, [href]);

  useLayoutEffect(() => {
    const saved = readScroll(href);
    const focusId = readFocus(href);
    if (!saved && !focusId) return;
    let userMoved = false;
    const stop = () => {
      userMoved = true;
    };
    window.addEventListener("wheel", stop, { passive: true, capture: true });
    window.addEventListener("touchmove", stop, { passive: true, capture: true });
    const started = performance.now();
    let raf = 0;
    let highlighted = false;
    const tick = () => {
      if (userMoved || highlighted) return;
      const root = workspaceRoot();
      if (focusId && root) {
        const target = root.querySelector<HTMLElement>(
          `[data-return-focus="${cssEscape(focusId)}"]`,
        );
        if (target) {
          target.scrollIntoView({ block: "center" });
          target.style.boxShadow = "inset 0 0 0 2px #111111";
          window.setTimeout(() => {
            target.style.boxShadow = "";
          }, 1800);
          highlighted = true;
          return;
        }
      }
      if (root && saved) {
        for (const [path, top] of Object.entries(saved)) {
          const el = elementAtScrollPath(asScrollNode(root), path);
          if (el instanceof HTMLElement && Math.abs(el.scrollTop - top) > 1) {
            el.scrollTop = top;
          }
        }
      }
      if (performance.now() - started < 4000) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("wheel", stop, true);
      window.removeEventListener("touchmove", stop, true);
    };
  }, [href]);
}
