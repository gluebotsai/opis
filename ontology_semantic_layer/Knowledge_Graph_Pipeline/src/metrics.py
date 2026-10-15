"""Metrics.  Spec section 13.  No third-party dependency.

Counters and histograms are held in memory and exposed two ways: a Prometheus
text endpoint on ``metrics.port`` and a periodic JSON log line, so the pipeline
is observable whether or not Prometheus is deployed.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from collections import defaultdict

log = logging.getLogger(__name__)


def _labels_to_key(labels: dict) -> tuple:
    return tuple(sorted((str(k), str(v)) for k, v in labels.items()))


class Metrics:
    def __init__(self) -> None:
        self._counters: dict[str, dict[tuple, float]] = defaultdict(lambda: defaultdict(float))
        self._gauges: dict[str, dict[tuple, float]] = defaultdict(lambda: defaultdict(float))
        self._hist: dict[str, dict[tuple, list]] = defaultdict(lambda: defaultdict(list))
        self._lock = threading.Lock()
        self._server = None

    def inc(self, name: str, value: float = 1.0, **labels) -> None:
        with self._lock:
            self._counters[name][_labels_to_key(labels)] += value

    def gauge(self, name: str, value: float, **labels) -> None:
        with self._lock:
            self._gauges[name][_labels_to_key(labels)] = value

    def observe(self, name: str, value: float, **labels) -> None:
        with self._lock:
            self._hist[name][_labels_to_key(labels)].append(value)

    def timer(self, name: str, **labels):
        return _Timer(self, name, labels)

    def snapshot(self) -> dict:
        with self._lock:
            out: dict = {"counters": {}, "gauges": {}, "timings": {}}
            for n, series in self._counters.items():
                for k, v in series.items():
                    out["counters"][_render(n, k)] = v
            for n, series in self._gauges.items():
                for k, v in series.items():
                    out["gauges"][_render(n, k)] = v
            for n, series in self._hist.items():
                for k, vals in series.items():
                    if vals:
                        s = sorted(vals)
                        out["timings"][_render(n, k)] = {
                            "count": len(s),
                            "p50": s[len(s) // 2],
                            "p95": s[int(len(s) * 0.95)] if len(s) > 1 else s[0],
                            "max": s[-1],
                        }
            return out

    def prometheus(self) -> str:
        lines: list[str] = []
        with self._lock:
            for n, series in self._counters.items():
                lines.append(f"# TYPE {n} counter")
                for k, v in series.items():
                    lines.append(f"{_render(n, k)} {v}")
            for n, series in self._gauges.items():
                lines.append(f"# TYPE {n} gauge")
                for k, v in series.items():
                    lines.append(f"{_render(n, k)} {v}")
            for n, series in self._hist.items():
                for k, vals in series.items():
                    if vals:
                        lines.append(f"{_render(n + '_sum', k)} {sum(vals)}")
                        lines.append(f"{_render(n + '_count', k)} {len(vals)}")
        return "\n".join(lines) + "\n"

    def log_line(self) -> None:
        log.info(json.dumps({"metrics": self.snapshot()}, default=str))

    def serve(self, port: int) -> None:
        from http.server import BaseHTTPRequestHandler, HTTPServer

        metrics = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):                                   # noqa: N802
                if self.path != "/metrics":
                    self.send_response(404)
                    self.end_headers()
                    return
                body = metrics.prometheus().encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; version=0.0.4")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):                       # silence access log
                return

        self._server = HTTPServer(("0.0.0.0", port), Handler)
        threading.Thread(target=self._server.serve_forever, daemon=True).start()
        log.info("metrics endpoint listening on :%d/metrics", port)


def _render(name: str, key: tuple) -> str:
    if not key:
        return name
    labels = ",".join(f'{k}="{v}"' for k, v in key)
    return f"{name}{{{labels}}}"


class _Timer:
    def __init__(self, metrics: Metrics, name: str, labels: dict):
        self.metrics, self.name, self.labels = metrics, name, labels

    def __enter__(self):
        self.start = time.perf_counter()
        return self

    def __exit__(self, *exc):
        self.metrics.observe(self.name, time.perf_counter() - self.start, **self.labels)
        return False
