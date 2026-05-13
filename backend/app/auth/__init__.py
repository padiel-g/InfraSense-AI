# Re-export from new core locations so existing routers need no changes.
from app.core.dependencies import get_current_user  # noqa: F401
from app.core.security import hash_password, verify_password, create_access_token  # noqa: F401
