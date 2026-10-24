"""Event normalization shared by every TapCub server SDK.

Rules: packages/shared/test-vectors/track/README.md (same limits as the server's request schema).
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import math
import re
import time as _time
from typing import Any, Dict, List, Mapping, Optional

LOGIN_ID_TYPES = ("login", "email", "mobile", "unionid", "openid", "custom")
PLATFORMS = (
    "web", "mp_weixin", "mp_alipay", "mp_bytedance", "mp_baidu", "mp_kuaishou", "mp_qq",
    "android", "ios", "harmony", "tvos", "watchos", "macos", "windows", "linux", "server", "import",
)
_GROUP_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,23}:[A-Za-z0-9_@.\-]{1,80}$")
_GROUP_TYPE_RE = re.compile(r"^[a-z][a-z0-9_]{0,23}$")
_HEX64 = re.compile(r"^[a-fA-F0-9]{64}$")
_COUNTRY = re.compile(r"^[A-Za-z]{2}$")
_CAMPAIGN_LIMITS = (
    ("source", 100), ("medium", 100), ("name", 100), ("term", 100), ("content", 100),
    ("ref", 64), ("click_id", 1000), ("landing_url", 2000), ("referrer", 2000),
)


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def utf16_len(s: str) -> int:
    """服务端 zod 的 max 按 JS .length（UTF-16 码元）计"""
    return len(s) + sum(1 for ch in s if ord(ch) > 0xFFFF)


def cut(s: str, n: int) -> str:
    """截到 ≤n 个 UTF-16 码元，不拆开代理对"""
    if len(s) <= n // 2 or utf16_len(s) <= n:
        return s
    units = 0
    for i, ch in enumerate(s):
        units += 2 if ord(ch) > 0xFFFF else 1
        if units > n:
            return s[:i]
    return s


def _text(v: Any) -> str:
    return v if isinstance(v, str) else str(v)


def require_text(name: str, v: Any, max_len: Optional[int] = None) -> str:
    s = _text(v).strip() if v is not None else ""
    if not s:
        raise ValueError(f"TapCub: {name} is required")
    if max_len is not None and utf16_len(s) > max_len:
        raise ValueError(f"TapCub: {name} must be at most {max_len} characters")
    return s


def optional_text(name: str, v: Any, max_len: int) -> Optional[str]:
    if v is None:
        return None
    s = _text(v).strip()
    if not s:
        return None
    if utf16_len(s) > max_len:
        raise ValueError(f"TapCub: {name} must be at most {max_len} characters")
    return s


def event_name(v: Any) -> str:
    s = _text(v).strip() if v is not None else ""
    if not s:
        raise ValueError("TapCub: event is required")
    return cut(s, 100)


def login_id_type(v: Any) -> Optional[str]:
    if v is None:
        return None
    if v not in LOGIN_ID_TYPES:
        raise ValueError(f"TapCub: login_id_type must be one of {', '.join(LOGIN_ID_TYPES)}")
    return v


def identity_value(kind: str, value: Any) -> str:
    v = _text(value).strip() if value is not None else ""
    if kind in ("email", "mobile"):
        n = v.lower() if kind == "email" else re.sub(r"[\s-]", "", v)
        return n.lower() if _HEX64.match(n) else sha256(n)
    return v


def identities(v: Optional[Mapping[str, Any]]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for k, raw in (v or {}).items():
        if k not in LOGIN_ID_TYPES:
            raise ValueError(f'TapCub: unknown identity type "{k}"')
        if raw is None or _text(raw).strip() == "":
            continue
        out[k] = identity_value(k, raw)
    return out


def group(v: Any) -> Optional[str]:
    if v is None:
        return None
    s = _text(v)
    if not _GROUP_KEY_RE.match(s):
        raise ValueError('TapCub: group must look like "type:id" (type: a-z, 0-9, _)')
    return s


def group_key(kind: Any, gid: Any) -> str:
    t = require_text("group_type", kind)
    if not _GROUP_TYPE_RE.match(t):
        raise ValueError("TapCub: group_type must start with a-z and contain only a-z, 0-9 and _ (at most 24)")
    return group(f"{t}:{require_text('group_id', gid)}")  # type: ignore[return-value]


def timestamp(v: Any) -> int:
    """毫秒时间戳；datetime 按自身时区（naive 视为本地时间，同 datetime.timestamp()）"""
    if v is None:
        return int(_time.time() * 1000)
    if isinstance(v, _dt.datetime):
        return int(v.timestamp() * 1000)
    if isinstance(v, bool) or not isinstance(v, (int, float)) or (isinstance(v, float) and not math.isfinite(v)):
        raise ValueError("TapCub: time must be milliseconds since the epoch or a datetime")
    return int(v)


def _json_text(v: Any) -> str:
    return json.dumps(v, separators=(",", ":"), ensure_ascii=False, default=_json_default)


def _json_default(o: Any) -> Any:
    if isinstance(o, (_dt.datetime, _dt.date)):
        return o.isoformat()
    if isinstance(o, (set, frozenset, tuple)):
        return list(o)
    return str(o)


def _scalar(v: Any) -> Any:
    """返回 None 表示丢弃"""
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return v if math.isfinite(v) else None
    if isinstance(v, str):
        return cut(v, 1000)
    if isinstance(v, (_dt.datetime, _dt.date)):
        return v.isoformat()
    if isinstance(v, (Mapping, list, tuple, set, frozenset)):
        return cut(_json_text(v), 1000)
    return cut(str(v), 1000)


def properties(p: Optional[Mapping[str, Any]]) -> Optional[Dict[str, Any]]:
    if not p:
        return None
    out: Dict[str, Any] = {}
    for k, v in p.items():
        key = cut(_text(k), 50)
        if isinstance(v, (list, tuple)) and v and all(isinstance(x, Mapping) for x in v):
            rows = []
            for o in list(v)[:100]:
                row = {}
                for ik, iv in o.items():
                    s = _scalar(iv)
                    if s is not None:
                        row[cut(_text(ik), 50)] = s
                rows.append(row)
            out[key] = rows
            continue
        s = _scalar(v)
        if s is not None:
            out[key] = s
    return out or None


def increment(p: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for k, v in (p or {}).items():
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            continue
        if isinstance(v, float) and not math.isfinite(v):
            continue
        out[cut(_text(k), 50)] = v
    return out


def append(p: Optional[Mapping[str, Any]]) -> Dict[str, List[Any]]:
    out: Dict[str, List[Any]] = {}
    for k, v in (p or {}).items():
        items = list(v) if isinstance(v, (list, tuple)) else [v]
        keep = [x for x in items if isinstance(x, (str, bool)) or (isinstance(x, (int, float)) and math.isfinite(x))]
        if keep:
            out[cut(_text(k), 50)] = keep[:20]
    return out


def unset_keys(keys: Any) -> List[str]:
    if isinstance(keys, (str, bytes)) or not isinstance(keys, (list, tuple)):
        raise ValueError("TapCub: keys must be a list of property names")
    return [cut(_text(k), 50) for k in keys if k is not None and _text(k) != ""][:50]


def campaign(c: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(c, Mapping):
        return None
    out: Dict[str, Any] = {}
    for k, lim in _CAMPAIGN_LIMITS:
        v = c.get(k)
        if v is not None and _text(v) != "":
            out[k] = cut(_text(v), lim)
    t = c.get("touched_at")
    if not isinstance(t, bool) and isinstance(t, (int, float)) and math.isfinite(t):
        out["touched_at"] = int(t)
    return out or None


def context(c: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(c, Mapping):
        return None
    out: Dict[str, Any] = {}
    for k, lim in (("ip", 45), ("user_agent", 1000), ("url", 2000)):
        v = c.get(k)
        if v is not None and _text(v) != "":
            out[k] = cut(_text(v), lim)
    if c.get("platform") in PLATFORMS:
        out["platform"] = c["platform"]
    country = c.get("country")
    if isinstance(country, str) and _COUNTRY.match(country):
        out["country"] = country.upper()
    lang = c.get("lang")
    if lang is not None and _text(lang) != "":
        out["lang"] = cut(_text(lang), 12)
    camp = campaign(c.get("campaign"))
    if camp:
        out["campaign"] = camp
    return out or None


def compact(ev: Mapping[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in ev.items() if v is not None}
