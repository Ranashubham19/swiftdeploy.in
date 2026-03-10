from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import decode_access_token
from app.db.session import get_db
from app.models.user import User


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = decode_access_token(token)
    except ValueError as error:
        raise credentials_error from error

    email = payload.get("sub")
    if not email:
        raise credentials_error

    user = db.scalar(select(User).where(User.email == email.lower()))
    if not user or not user.is_active:
        raise credentials_error
    return user


def get_request_user(
    authorization: str | None = Header(default=None),
    internal_token: str | None = Header(default=None, alias="X-Worker-Service-Token"),
    internal_email: str | None = Header(default=None, alias="X-Worker-User-Email"),
    internal_name: str | None = Header(default=None, alias="X-Worker-User-Name"),
    internal_telegram_chat_id: str | None = Header(default=None, alias="X-Worker-Telegram-Chat-Id"),
    db: Session = Depends(get_db),
) -> User:
    settings = get_settings()

    if internal_token and internal_email and internal_token == settings.internal_service_token:
        user = db.scalar(select(User).where(User.email == internal_email.lower()))
        if not user:
            user = User(
                email=internal_email.lower(),
                password_hash="internal-bridge-user",
                full_name=internal_name,
                telegram_chat_id=internal_telegram_chat_id,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        else:
            changed = False
            if internal_name and internal_name != user.full_name:
                user.full_name = internal_name
                changed = True
            if internal_telegram_chat_id and internal_telegram_chat_id != user.telegram_chat_id:
                user.telegram_chat_id = internal_telegram_chat_id
                changed = True
            if changed:
                db.commit()
                db.refresh(user)
        return user

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization.split(" ", 1)[1].strip()
    return get_current_user(token=token, db=db)
