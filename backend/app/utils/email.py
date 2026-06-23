import logging

from fastapi_mail import FastMail, MessageSchema, MessageType
from pydantic import NameEmail

from backend.app.core.settings import settings

logger = logging.getLogger(__name__)


async def send_email(
    *,
    subject: str,
    email_to: str,
    message: str,
) -> None:
    email = MessageSchema(
        subject=subject,
        recipients=[NameEmail(name=email_to, email=email_to)],
        body=message,
        subtype=MessageType.plain,
    )
    fm = FastMail(settings.mail_config)
    try:
        await fm.send_message(email)
    except Exception as e:
        logger.warning("Email sending failed: %s (SMTP not configured?)", e)
