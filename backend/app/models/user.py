import uuid
from sqlalchemy import Column, String, Boolean, DateTime, Enum, func
from app.database import Base
from app.models.enums import UserRole, Department


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String(255), unique=True, nullable=False, index=True)
    full_name = Column(String(255), nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(
        Enum(UserRole, name="user_role", create_constraint=True),
        default=UserRole.field_crew,
        nullable=False,
    )
    department = Column(
        Enum(Department, name="department", create_constraint=True),
        nullable=True,
    )
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
