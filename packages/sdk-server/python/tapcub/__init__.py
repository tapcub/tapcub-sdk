"""TapCub server-side SDK for Python: events, sign-ups, identities, user profiles, items and accounts.

    from tapcub import TapCub
    tc = TapCub("wck_…")
    tc.track("purchase", login_id="user-1", insert_id="order-1", properties={"revenue": 19.9})
    tc.close()
"""
from .client import DEFAULT_ENDPOINT, TapCub, TapCubError, from_request_headers, normalize_endpoint
from .version import VERSION

__version__ = VERSION
__all__ = ["TapCub", "TapCubError", "from_request_headers", "normalize_endpoint", "DEFAULT_ENDPOINT", "VERSION", "__version__"]
