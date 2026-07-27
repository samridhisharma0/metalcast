"""The ensemble members.

Contract: every model takes the close series and a list of horizons (in trading
bars) and returns the *cumulative log return* it expects from the last observed
close. Working in log space keeps the horizons additive, makes the uncertainty
scale as sqrt(h), and guarantees the price bands stay positive when we
exponentiate.
"""
from __future__ import annotations

import logging
import warnings
from contextlib import contextmanager
from typing import Dict, List

import numpy as np

from .features import build_matrix, supervised

log = logging.getLogger("metalcast.forecast")
warnings.filterwarnings("ignore")


@contextmanager
def _quiet():
    """statsmodels resets warning filters internally, so scope them locally."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        yield

try:  # optional heavy deps — the engine degrades instead of crashing
    from sklearn.ensemble import HistGradientBoostingRegressor
    from sklearn.linear_model import Ridge
    HAVE_SKLEARN = True
except Exception:  # pragma: no cover
    HAVE_SKLEARN = False
    log.warning("scikit-learn unavailable — tabular models disabled")

try:
    from statsmodels.tsa.holtwinters import ExponentialSmoothing
    from statsmodels.tsa.statespace.sarimax import SARIMAX
    HAVE_STATSMODELS = True
except Exception:  # pragma: no cover
    HAVE_STATSMODELS = False
    log.warning("statsmodels unavailable — Holt/ARIMA disabled")


MIN_POINTS = 60


def _empty(horizons: List[int]) -> Dict[int, float]:
    return {h: 0.0 for h in horizons}


# --------------------------------------------------------------------------- #
# 1. Damped random walk with shrunken drift  (the honest baseline)
# --------------------------------------------------------------------------- #
def m_drift(close: np.ndarray, horizons: List[int]) -> Dict[int, float]:
    logp = np.log(close)
    if len(logp) < 20:
        return _empty(horizons)
    rets = np.diff(logp)
    recent = rets[-min(len(rets), 120):]
    mu = float(np.mean(recent))
    # Commodity drift estimated on <1y of data is mostly noise. Shrink hard and
    # damp further as the horizon extends.
    mu *= 0.35
    out = {}
    for h in horizons:
        damp = 0.94 ** min(h, 60)
        cumulative = mu * sum(damp ** k for k in range(h)) if damp < 1 else mu * h
        out[h] = float(np.clip(cumulative, -0.6, 0.6))
    return out


# --------------------------------------------------------------------------- #
# 2. Theta method (dependency-free, very strong on M-competition data)
# --------------------------------------------------------------------------- #
def m_theta(close: np.ndarray, horizons: List[int]) -> Dict[int, float]:
    logp = np.log(close)
    n = len(logp)
    if n < MIN_POINTS:
        return _empty(horizons)
    window = min(n, 252)
    y = logp[-window:]
    t = np.arange(window, dtype=float)
    slope, intercept = np.polyfit(t, y, 1)

    alpha = 0.25
    level = y[0]
    for value in y[1:]:
        level = alpha * value + (1 - alpha) * level

    anchor = logp[-1]
    out = {}
    for h in horizons:
        ses = level
        trend = 0.5 * slope * h
        forecast = ses + trend + (anchor - level) * (0.9 ** h)
        out[h] = float(np.clip(forecast - anchor, -0.6, 0.6))
    return out


# --------------------------------------------------------------------------- #
# 3. Holt damped-trend exponential smoothing
# --------------------------------------------------------------------------- #
def m_holt(close: np.ndarray, horizons: List[int]) -> Dict[int, float]:
    if not HAVE_STATSMODELS or len(close) < MIN_POINTS:
        return m_theta(close, horizons)
    logp = np.log(close)
    try:
      with _quiet():
        fit = ExponentialSmoothing(
            logp[-min(len(logp), 500):],
            trend="add",
            damped_trend=True,
            seasonal=None,
            initialization_method="estimated",
        ).fit(optimized=True)
        fc = np.asarray(fit.forecast(max(horizons)))
        anchor = logp[-1]
        return {h: float(np.clip(fc[h - 1] - anchor, -0.6, 0.6)) for h in horizons}
    except Exception as exc:
        log.debug("holt failed: %s", exc)
        return m_theta(close, horizons)


# --------------------------------------------------------------------------- #
# 4. ARIMA(1,1,1) on log price
# --------------------------------------------------------------------------- #
def m_arima(close: np.ndarray, horizons: List[int]) -> Dict[int, float]:
    if not HAVE_STATSMODELS or len(close) < 120:
        return m_drift(close, horizons)
    logp = np.log(close)[-min(len(close), 600):]
    for order in ((1, 1, 1), (0, 1, 1), (1, 1, 0)):
        try:
          with _quiet():
            fit = SARIMAX(
                logp, order=order,
                trend="c" if order[1] == 1 else "n",
                enforce_stationarity=False,
                enforce_invertibility=False,
            ).fit(disp=False, maxiter=50)
            fc = np.asarray(fit.forecast(max(horizons)))
            anchor = logp[-1]
            result = {h: float(np.clip(fc[h - 1] - anchor, -0.6, 0.6)) for h in horizons}
            if all(np.isfinite(v) for v in result.values()):
                return result
        except Exception as exc:
            log.debug("arima%s failed: %s", order, exc)
            continue
    return m_drift(close, horizons)


# --------------------------------------------------------------------------- #
# 5. Gradient-boosted direct multi-horizon regression
# --------------------------------------------------------------------------- #
def m_gbm(close: np.ndarray, horizons: List[int]) -> Dict[int, float]:
    if not HAVE_SKLEARN or len(close) < 200:
        return _empty(horizons)
    out: Dict[int, float] = {}
    latest = build_matrix(close)[-1:].astype(float)
    for h in horizons:
        try:
            X, y = supervised(close, h)
            if len(y) < 80:
                out[h] = 0.0
                continue
            model = HistGradientBoostingRegressor(
                max_iter=110,
                learning_rate=0.075,
                max_depth=3,
                min_samples_leaf=20,
                l2_regularization=1.0,
                early_stopping=False,
                random_state=7,
            )
            model.fit(X, y)
            pred = float(model.predict(latest)[0])
            # a tree model can only reproduce returns it saw; keep it honest
            cap = float(np.percentile(np.abs(y), 97)) if len(y) else 0.1
            out[h] = float(np.clip(pred, -cap, cap))
        except Exception as exc:
            log.debug("gbm h=%s failed: %s", h, exc)
            out[h] = 0.0
    return out


# --------------------------------------------------------------------------- #
# 6. Ridge on the same features (linear, fast, different bias)
# --------------------------------------------------------------------------- #
def m_ridge(close: np.ndarray, horizons: List[int]) -> Dict[int, float]:
    if not HAVE_SKLEARN or len(close) < 160:
        return _empty(horizons)
    out: Dict[int, float] = {}
    latest = build_matrix(close)[-1:].astype(float)
    for h in horizons:
        try:
            X, y = supervised(close, h)
            if len(y) < 60:
                out[h] = 0.0
                continue
            mu, sd = X.mean(axis=0), X.std(axis=0)
            sd[sd < 1e-9] = 1.0
            model = Ridge(alpha=8.0)
            model.fit((X - mu) / sd, y)
            pred = float(model.predict((latest - mu) / sd)[0])
            cap = float(np.percentile(np.abs(y), 95)) if len(y) else 0.1
            out[h] = float(np.clip(pred, -cap, cap))
        except Exception as exc:
            log.debug("ridge h=%s failed: %s", h, exc)
            out[h] = 0.0
    return out


# --------------------------------------------------------------------------- #
# 7. Mean reversion to the long moving average (dominant at multi-month range)
# --------------------------------------------------------------------------- #
def m_reversion(close: np.ndarray, horizons: List[int]) -> Dict[int, float]:
    logp = np.log(close)
    n = len(logp)
    if n < 120:
        return _empty(horizons)
    window = min(n, 200)
    anchor_ma = float(np.mean(logp[-window:]))
    gap = float(logp[-1] - anchor_ma)
    # half-life of ~70 trading days for base metals around their moving average
    half_life = 70.0
    out = {}
    for h in horizons:
        pull = -gap * (1.0 - 0.5 ** (h / half_life))
        out[h] = float(np.clip(pull, -0.5, 0.5))
    return out


MODELS = {
    "drift": m_drift,
    "theta": m_theta,
    "holt": m_holt,
    "arima": m_arima,
    "gbm": m_gbm,
    "ridge": m_ridge,
    "reversion": m_reversion,
}

# Models cheap enough to refit at every walk-forward origin.
FAST_MODELS = ("drift", "theta", "reversion", "ridge")
SLOW_MODELS = ("holt", "arima", "gbm")

MODEL_LABELS = {
    "drift": "Damped drift baseline",
    "theta": "Theta method",
    "holt": "Holt damped trend",
    "arima": "ARIMA(1,1,1)",
    "gbm": "Gradient boosting",
    "ridge": "Ridge regression",
    "reversion": "Mean reversion (200d)",
}
