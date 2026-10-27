from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..core.database import Base


class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False)  # cashier, supervisor, admin
    description = Column(String(255))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    users = relationship("User", back_populates="role")


# Every capability a role can be granted, checked dynamically instead of the
# old hardcoded `if role.name == "cashier"` scattered across routers — an
# admin can now flip these on/off per role from Settings without a code
# change or redeploy.
class RolePermission(Base):
    __tablename__ = "role_permissions"

    id = Column(Integer, primary_key=True, index=True)
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=False)
    permission_key = Column(String(100), nullable=False)
    allowed = Column(Boolean, default=False, nullable=False)

    role = relationship("Role")

    __table_args__ = (UniqueConstraint("role_id", "permission_key", name="uq_role_permission"),)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    full_name = Column(String(200), nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=False)
    is_active = Column(Boolean, default=True)
    failed_login_attempts = Column(Integer, default=0, nullable=False)
    locked_until = Column(DateTime(timezone=True), nullable=True)
    must_change_password = Column(Boolean, default=False, nullable=False)
    avatar = Column(String, nullable=True)   # base64 data URI of a small resized profile photo
    email = Column(String(255), nullable=True)
    phone = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    role = relationship("Role", back_populates="users")
    invoices_created = relationship("Invoice", foreign_keys="Invoice.created_by_id", back_populates="created_by")
    invoices_updated = relationship("Invoice", foreign_keys="Invoice.updated_by_id", back_populates="updated_by")
    activity_logs = relationship("ActivityLog", back_populates="user")
