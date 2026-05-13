# THIS FILE IS A DEAD SCAFFOLD — DO NOT IMPORT OR USE.
#
# The real auth router lives at app/api/auth.py and is mounted in main.py
# with prefix="/api/auth".  The routes defined here (/auth/register,
# /auth/login) were never wired into the app but caused confusion because
# the frontend was historically calling /auth/* (missing the /api prefix).
#
# If you need to add new auth routes, add them to app/api/auth.py.
raise ImportError(
    "app.routes is a dead scaffold and must not be imported. "
    "See app/api/auth.py for the real auth router."
)
