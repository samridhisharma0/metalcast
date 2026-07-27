"""Feature engineering for the tabular (gradient-boosted) forecaster.

Everything is derived from the daily close series only. That is a deliberate
constraint: features that need data we do not persist (LME warehouse stocks,
CNY basis, treatment charges) would make the model unreproducible from this
repository alone.
"""
from __future__ import annotations

from typing import Dict, List, Tuple

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

FEATURE_NAMES: List[str] = [
    "ret_1", "ret_2", "ret_3", "ret_5", "ret_10", "ret_21", "ret_63",
    "vol_5", "vol_10", "vol_21", "vol_63",
    "vol_ratio_5_21", "vol_ratio_21_63",
    "z_20", "z_50", "z_200",
    "ma_gap_5_20", "ma_gap_20_50", "ma_gap_50_200",
    "rsi_14", "macd", "macd_signal", "macd_hist",
    "bb_pos_20", "range_pos_63", "range_pos_252",
    "skew_63", "kurt_63", "dow",
]


def _safe(a: np.ndarray) -> np.ndarray:
    return np.nan_to_num(a, nan=0.0, posinf=0.0, neginf=0.0)


_AGGS = {
    "mean": lambda v: v.mean(axis=-1),
    "std": lambda v: v.std(axis=-1),
    "min": lambda v: v.min(axis=-1),
    "max": lambda v: v.max(axis=-1),
}


def _rolling(a: np.ndarray, window: int, fn) -> np.ndarray:
    """Trailing rolling aggregate, vectorised.

    The naive version (a Python loop slicing the array once per index) cost
    ~130 ms per feature matrix, and the matrix is rebuilt at every backtest
    origin — that alone was 8 s of a 27 s forecast run. sliding_window_view
    gives the same numbers about 40x faster.
    """
    n = len(a)
    out = np.full(n, np.nan)
    if n == 0:
        return out

    key = None
    for name, agg in _AGGS.items():
        if fn is getattr(np, name, None):
            key = name
            break

    w = min(window, n)
    min_periods = max(2, window // 3)

    if key is not None and w >= 2:
        view = sliding_window_view(a, w)
        out[w - 1:] = _AGGS[key](view)
    elif w >= 2:
        # generic callable (skew / kurtosis): still vectorised over the window
        view = sliding_window_view(a, w)
        out[w - 1:] = np.apply_along_axis(fn, 1, view)

    # warm-up region: expanding window, at most `window` iterations
    upper = min(w - 1, n)
    for i in range(min_periods - 1, upper):
        chunk = a[: i + 1]
        if len(chunk) >= min_periods:
            out[i] = fn(chunk)
    return out


def _ema(a: np.ndarray, span: int) -> np.ndarray:
    alpha = 2.0 / (span + 1.0)
    out = np.empty_like(a, dtype=float)
    if len(a) == 0:
        return out
    out[0] = a[0]
    for i in range(1, len(a)):
        out[i] = alpha * a[i] + (1 - alpha) * out[i - 1]
    return out


def _rsi(close: np.ndarray, period: int = 14) -> np.ndarray:
    n = len(close)
    out = np.full(n, 50.0)
    if n < period + 1:
        return out
    delta = np.diff(close, prepend=close[0])
    gain = np.where(delta > 0, delta, 0.0)
    loss = np.where(delta < 0, -delta, 0.0)
    avg_g = _ema(gain, period)
    avg_l = _ema(loss, period)
    rs = np.divide(avg_g, np.where(avg_l == 0, 1e-12, avg_l))
    out = 100.0 - (100.0 / (1.0 + rs))
    return _safe(out)


# The matrix is rebuilt for every horizon and every backtest origin, always
# from the same underlying slice. Memoising on the array's raw bytes turns
# 26 rebuilds per run into one.
_CACHE: "Dict[bytes, np.ndarray]" = {}
_CACHE_MAX = 96


def build_matrix(close: np.ndarray, weekday: np.ndarray | None = None) -> np.ndarray:
    """Return an (n, n_features) matrix aligned to `close` (memoised)."""
    close = np.ascontiguousarray(np.asarray(close, dtype=float))
    cache_key = None
    if weekday is None:
        cache_key = close.tobytes()
        hit = _CACHE.get(cache_key)
        if hit is not None:
            return hit
    return _build_matrix_uncached(close, weekday, cache_key)


def _build_matrix_uncached(close: np.ndarray, weekday, cache_key) -> np.ndarray:
    result = _compute_matrix(close, weekday)
    if cache_key is not None:
        if len(_CACHE) >= _CACHE_MAX:
            _CACHE.clear()
        _CACHE[cache_key] = result
    return result


def _compute_matrix(close: np.ndarray, weekday: np.ndarray | None = None) -> np.ndarray:
    close = np.asarray(close, dtype=float)
    n = len(close)
    logp = np.log(close)
    ret1 = np.diff(logp, prepend=logp[0])

    def lag_ret(k: int) -> np.ndarray:
        out = np.full(n, 0.0)
        if n > k:
            out[k:] = logp[k:] - logp[:-k]
        return out

    vol5 = _rolling(ret1, 5, np.std)
    vol10 = _rolling(ret1, 10, np.std)
    vol21 = _rolling(ret1, 21, np.std)
    vol63 = _rolling(ret1, 63, np.std)

    ma5 = _rolling(close, 5, np.mean)
    ma20 = _rolling(close, 20, np.mean)
    ma50 = _rolling(close, 50, np.mean)
    ma200 = _rolling(close, 200, np.mean)
    sd20 = _rolling(close, 20, np.std)
    sd50 = _rolling(close, 50, np.std)
    sd200 = _rolling(close, 200, np.std)

    ema12, ema26 = _ema(close, 12), _ema(close, 26)
    macd = ema12 - ema26
    macd_sig = _ema(macd, 9)

    hi63, lo63 = _rolling(close, 63, np.max), _rolling(close, 63, np.min)
    hi252, lo252 = _rolling(close, 252, np.max), _rolling(close, 252, np.min)

    def skew(x: np.ndarray) -> float:
        s = np.std(x)
        return float(np.mean(((x - np.mean(x)) / s) ** 3)) if s > 1e-12 else 0.0

    def kurt(x: np.ndarray) -> float:
        s = np.std(x)
        return float(np.mean(((x - np.mean(x)) / s) ** 4) - 3.0) if s > 1e-12 else 0.0

    dow = weekday if weekday is not None else np.zeros(n)

    cols = [
        ret1, lag_ret(2), lag_ret(3), lag_ret(5), lag_ret(10), lag_ret(21), lag_ret(63),
        vol5, vol10, vol21, vol63,
        np.divide(vol5, np.where(_safe(vol21) == 0, 1e-9, vol21)),
        np.divide(vol21, np.where(_safe(vol63) == 0, 1e-9, vol63)),
        np.divide(close - ma20, np.where(_safe(sd20) == 0, 1e-9, sd20)),
        np.divide(close - ma50, np.where(_safe(sd50) == 0, 1e-9, sd50)),
        np.divide(close - ma200, np.where(_safe(sd200) == 0, 1e-9, sd200)),
        np.divide(ma5 - ma20, np.where(_safe(ma20) == 0, 1e-9, ma20)),
        np.divide(ma20 - ma50, np.where(_safe(ma50) == 0, 1e-9, ma50)),
        np.divide(ma50 - ma200, np.where(_safe(ma200) == 0, 1e-9, ma200)),
        _rsi(close) / 100.0,
        np.divide(macd, np.where(close == 0, 1e-9, close)),
        np.divide(macd_sig, np.where(close == 0, 1e-9, close)),
        np.divide(macd - macd_sig, np.where(close == 0, 1e-9, close)),
        np.divide(close - ma20, np.where(_safe(sd20) * 2 == 0, 1e-9, sd20 * 2)),
        np.divide(close - lo63, np.where(_safe(hi63 - lo63) == 0, 1e-9, hi63 - lo63)),
        np.divide(close - lo252, np.where(_safe(hi252 - lo252) == 0, 1e-9, hi252 - lo252)),
        _rolling(ret1, 63, skew),
        _rolling(ret1, 63, kurt),
        dow / 6.0,
    ]
    matrix = np.column_stack([_safe(np.asarray(c, dtype=float)) for c in cols])
    return np.ascontiguousarray(np.clip(matrix, -25.0, 25.0))


def clear_cache() -> None:
    _CACHE.clear()


def supervised(close: np.ndarray, horizon: int, weekday: np.ndarray | None = None
               ) -> Tuple[np.ndarray, np.ndarray]:
    """X, y where y = cumulative log return over `horizon` future bars."""
    X = build_matrix(close, weekday)
    logp = np.log(np.asarray(close, dtype=float))
    n = len(logp)
    if n <= horizon + 1:
        return np.empty((0, X.shape[1])), np.empty(0)
    y = logp[horizon:] - logp[:-horizon]
    X = X[: n - horizon]
    warmup = min(210, max(0, len(X) - 60))
    return X[warmup:], y[warmup:]
