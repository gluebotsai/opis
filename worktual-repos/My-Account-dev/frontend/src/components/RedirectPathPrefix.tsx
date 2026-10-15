// @ts-nocheck
import { Navigate, useLocation } from "react-router-dom";

export function RedirectPathPrefix({ from, to }) {
  const location = useLocation();
  const suffix = location.pathname.startsWith(from) ? location.pathname.slice(from.length) : "";
  const nextPath = `${to}${suffix}`;

  return <Navigate replace to={`${nextPath}${location.search}${location.hash}`} />;
}
