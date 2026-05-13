"""
Round-trip smoke test for auth.utils — no DB, no FastAPI.

Run:  python -m tools.smoke_test
Expected: all three checks print True.
"""

import os
import sys

# Mirror your runtime env. If AUTH_PEPPER is set in prod, set it here too.
# os.environ["AUTH_PEPPER"] = "same-value-as-prod"

from auth.utils import hash_password, verify_password, validate_password_strength

PW = "Str0ng!Password"

try:
    validate_password_strength(PW)
    print("policy ok          :", True)
except Exception as e:
    print("policy FAILED      :", e)
    sys.exit(1)

h = hash_password(PW)
print("hash prefix        :", h[:7], "(should be $2b$12$)")

print("verify correct pw  :", verify_password(PW, h))        # must be True
print("verify wrong pw    :", verify_password("nope", h))    # must be False
print("AUTH_PEPPER set    :", bool(os.getenv("AUTH_PEPPER")))
