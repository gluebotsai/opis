import os
import random
import re
import calendar
import datetime
import json
import pytz
import smtplib
from dateutil import parser
from zoneinfo import ZoneInfo
import pandas as pd
from datetime import timedelta
import requests
from email.mime.text import MIMEText
import phonenumbers
from phonenumbers import NumberParseException
from geotext import GeoText
import pycountry
from duckduckgo_search import DDGS
from typing import Optional

from app.agents.custom_lola_worktual.memory import Memory, SessionManager
from app.agents.custom_lola_worktual.llm import get_worktual_llm
from app.agents.custom_lola_worktual.session import (
    get_long_term_summary,
    get_turn_context,
    get_verified_contact,
    set_verified_contact,
)
from app.agents.custom_lola_worktual.adapters.callback import request_bot_callback
from app.config import get_settings


def insert_scheduling_details_india(*_args, **_kwargs):
    return {"status": "success", "message": "scheduled"}


''' GLOBAL INIT '''
try:
    _company_csv = os.getenv("COMPANY_CONTACT_CSV", "")
    df = pd.read_csv(_company_csv) if _company_csv and os.path.isfile(_company_csv) else pd.DataFrame()
except Exception as e:
    print(f"WARNING: company contact CSV not loaded: {e}")
    df = pd.DataFrame()
OTP_MANAGER = {}
user_details = {}
llm = get_worktual_llm()


def get_conversation_summary(domain_id, cookie_id, formatted_time):
    try:
        context = get_turn_context(str(cookie_id))
        conversation_id = context.get("conversation_id") or str(cookie_id)
        tenant_context = context.get("tenant_context") or {}
        summary = get_long_term_summary(conversation_id, tenant_context)
        return summary.strip() if summary and summary.strip() else "No information provided"
    except Exception as e:
        print("EXCEPTION IN LONGTERM SUMMARY", e)
        return "No information provided"


def generate_otp():
  return random.randint(100000,999999) 

session_manager = SessionManager()


''' TOOLS '''

class Tool():
    
    def __init__(self,tool_schema,tool_function):
        self.tool_schema = tool_schema
        self.tool_function = tool_function

    def run(self,*args,**kwargs):     
        return self.tool_function(*args,**kwargs)
    

AGENT_ROUTE_TOOL = {
    "type": "function",
    "function": {
        "name": "route_to_agent",
        "description": "Route the conversation to other agent specific agents SalesAgent,BookingAgent,ServiceAgent",
        "parameters": {
            "type": "object",
            "properties": {
                "agent_name": {"type": "string"},
                "query": {"type": "string"}
            },
            "required": ["agent_name", "query"]
        }
    }
}

def route_to_agent(agent_name: str, query: str,**kwargs):
    return {
        "agent_name": agent_name,
        "query": query
    }

agent_route_tool = Tool(tool_schema=AGENT_ROUTE_TOOL,tool_function=route_to_agent)


" ========================================= APPOINTMENT TOOLS ======================================================"


ip_address_list=["182.66.104.114","14.97.124.22","81.24.197.210","46.43.150.162","localhost"]

CRM_APPOINTMENTS_BASE_URL = (
    get_settings().crm_appointments_base_url.strip() or "https://rebuild-crm.worktual.com"
)
CRM_INTERNAL_SECRET = os.getenv("CRM_INTERNAL_SECRET", "2b179c0d739539750168566ca295a7df")
# Custom Lola Worktual webchat is org 1003 only; CRM APIs use organization id, not legacy domain id.
CUSTOM_LOLA_CRM_ORGANIZATION_ID = "1003"
CRM_DEFAULT_TIMEZONE = os.getenv("CRM_DEFAULT_TIMEZONE", "Asia/Kolkata")
CRM_APPOINTMENT_DURATION_MINUTES = int(os.getenv("CRM_APPOINTMENT_DURATION_MINUTES", "30"))
CRM_CONTACT_SYNC_URL = os.getenv("CRM_CONTACT_SYNC_URL", "https://nlp.worktual.co.uk/contact_request_mcp")
CRM_SOURCE_DOMAIN = os.getenv("CRM_SOURCE_DOMAIN", "https://worktual.in")
CRM_CONTACT_SOURCE = os.getenv("CRM_CONTACT_SOURCE", "Lola_chatbot")

WEBCHAT_TICKETS_BASE_URL = os.getenv("WEBCHAT_TICKETS_BASE_URL", "http://82.113.92.47:3100")
WEBCHAT_TICKETS_API_KEY = os.getenv("WEBCHAT_TICKETS_API_KEY", "")


def _normalize_webchat_api_key(api_key):
    api_key = (api_key or "").strip()
    if api_key.startswith("Wt_live"):
        return "wt_live" + api_key[7:]
    return api_key


def _webchat_ticket_headers():
    return {
        "Authorization": f"Bearer {_normalize_webchat_api_key(WEBCHAT_TICKETS_API_KEY)}",
        "Content-Type": "application/json",
    }


def create_webchat_ticket(name, issue, email=None, mobile=None):
    payload = {"name": name, "issue": issue}
    if email:
        payload["email"] = email
    if mobile:
        payload["mobile"] = mobile
    response = requests.post(
        f"{WEBCHAT_TICKETS_BASE_URL}/api/webchat/tickets",
        headers=_webchat_ticket_headers(),
        json=payload,
        timeout=15,
    )
    return response


def lookup_webchat_tickets(email):
    response = requests.post(
        f"{WEBCHAT_TICKETS_BASE_URL}/api/webchat/tickets/lookup",
        headers=_webchat_ticket_headers(),
        json={"email": email},
        timeout=15,
    )
    return response


def _crm_appointment_headers():
    return {
        "x-internal-secret": CRM_INTERNAL_SECRET,
        "x-organization-id": CUSTOM_LOLA_CRM_ORGANIZATION_ID,
    }


def _crm_json_headers():
    return {
        **_crm_appointment_headers(),
        "Content-Type": "application/json",
    }


def preferred_datetime_to_iso(preferred_datetime, timezone_str=CRM_DEFAULT_TIMEZONE):
    time_str = preferred_datetime.strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}", time_str):
        dt = parser.parse(time_str, dayfirst=False)
    else:
        dt = parser.parse(time_str, dayfirst=True)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo(timezone_str))
    return dt.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _extract_contact_id(payload):
    if payload is None:
        return None
    if isinstance(payload, (str, int)):
        return str(payload)
    if not isinstance(payload, dict):
        return None

    for key in ("contactId", "contact_id", "cdp_id", "cdpId", "id"):
        value = payload.get(key)
        if value not in (None, ""):
            return str(value)

    for nested_key in ("contact", "data", "result", "results"):
        nested = payload.get(nested_key)
        contact_id = _extract_contact_id(nested)
        if contact_id:
            return contact_id
    return None


def sync_contact_and_get_id(first_name, last_name, mobile_number, email, industry,
                            company_name, cookie_id, summary, plan_name, preferred_datetime):
    try:
        url = CRM_CONTACT_SYNC_URL
        payload = {
            "organization_id": CUSTOM_LOLA_CRM_ORGANIZATION_ID,
            "first_name": first_name,
            "last_name": last_name,
            "phone_number": mobile_number,
            "primary_email": email,
            "industry": industry,
            "company_name": company_name,
            "source": CRM_CONTACT_SOURCE,
            "appointment": "1",
            "domain": CRM_SOURCE_DOMAIN,
            "cookieId": cookie_id,
            "conversation": summary,
            "schedule_datetime": preferred_datetime,
            "selectedproducts": plan_name,
        }
        print("WORKTUAL CRM CONTACT SYNC PAYLOAD", payload)
        response = requests.post(url, json=payload, timeout=15)
        response.raise_for_status()
        data = response.json()
        print("WORKTUAL CRM CONTACT SYNC STATUS : ", data)
        return _extract_contact_id(data)
    except Exception as e:
        print("ERROR IN CRM CONTACT SYNC : ", e)
        return None


def check_appointment_availability(contact_id, starts_at, timezone_str=CRM_DEFAULT_TIMEZONE,
                                   duration_minutes=CRM_APPOINTMENT_DURATION_MINUTES):
    url = f"{CRM_APPOINTMENTS_BASE_URL}/api/appointments/availability"
    params = {
        "contactId": contact_id,
        "startsAt": starts_at,
        "timezone": timezone_str,
        "durationMinutes": duration_minutes,
    }
    response = requests.get(url, headers=_crm_appointment_headers(), params=params, timeout=15)
    response.raise_for_status()
    return response.json()


def create_crm_appointment(contact_id, title, starts_at, timezone_str=CRM_DEFAULT_TIMEZONE,
                           duration_minutes=CRM_APPOINTMENT_DURATION_MINUTES):
    url = f"{CRM_APPOINTMENTS_BASE_URL}/api/appointments"
    payload = {
        "contactId": str(contact_id),
        "title": title,
        "startsAt": starts_at,
        "timezone": timezone_str,
        "durationMinutes": duration_minutes,
    }
    response = requests.post(url, headers=_crm_json_headers(), json=payload, timeout=15)
    return response


def get_crm_appointment_by_contact(contact_id):
    url = f"{CRM_APPOINTMENTS_BASE_URL}/api/appointments/by-contact/{contact_id}"
    response = requests.get(url, headers=_crm_appointment_headers(), timeout=15)
    return response


def reschedule_crm_appointment(appointment_id, starts_at, title,
                               timezone_str=CRM_DEFAULT_TIMEZONE):
    url = f"{CRM_APPOINTMENTS_BASE_URL}/api/appointments/{appointment_id}"
    payload = {
        "startsAt": starts_at,
        "timezone": timezone_str,
        "title": title,
    }
    response = requests.patch(url, headers=_crm_json_headers(), json=payload, timeout=15)
    return response


def cancel_crm_appointment(appointment_id):
    url = f"{CRM_APPOINTMENTS_BASE_URL}/api/appointments/{appointment_id}/cancel"
    response = requests.post(url, headers=_crm_appointment_headers(), timeout=15)
    return response


def cdp_contact_id_for_email(email: str) -> str:
    """CRM contactId is the customer-store cdp_id. Do not create a contact here."""
    from app.agents.custom_booxoo_bot.clients.cdp_store import lookup_customer

    record = lookup_customer(CUSTOM_LOLA_CRM_ORGANIZATION_ID, (email or "").strip(), "")
    if not record or not record.get("found"):
        return ""
    return str(record.get("cdp_id") or "")


def _live_appointment(contact_id: str):
    lookup = get_crm_appointment_by_contact(contact_id)
    if lookup.status_code == 404:
        return None
    if lookup.status_code != 200:
        return lookup
    body = lookup.json() if getattr(lookup, "text", None) or getattr(lookup, "content", None) else {}
    appointment = body.get("appointment") if isinstance(body, dict) else None
    if not isinstance(appointment, dict) and isinstance(body, dict) and body.get("id"):
        appointment = body
    if not isinstance(appointment, dict) or not appointment.get("id"):
        return None
    if str(appointment.get("status") or "scheduled").lower() == "canceled":
        return None
    return appointment


def _appointment_is_upcoming(appointment: dict) -> bool:
    raw = str(appointment.get("startsAt") or "").strip()
    if not raw:
        return True
    try:
        when = parser.parse(raw)
    except (ValueError, TypeError, OverflowError):
        return True
    if when.tzinfo is None:
        when = when.replace(tzinfo=ZoneInfo("UTC"))
    return when > datetime.datetime.now(when.tzinfo)


def _existing_demo_message(appointment: dict) -> str:
    when = appointment.get("startsAt") or ""
    join_url = appointment.get("joinUrl") or ""
    response = "This email already has an upcoming demo"
    if when:
        response += f" at {when}"
    response += "."
    if join_url:
        response += f" The meeting link is {join_url}."
    response += (
        " They can discuss this in that demo. Do not book another demo for this email."
        " A demo for a different person uses that person's name, mobile, email, and time."
        " Cancellation is not available in this chat. Connect them with a live agent."
    )
    return response


def date_format_reschedule(time_str):
    try:
        dt = parser.parse(time_str, dayfirst=True)
        
        # Format start_time
        start_time = dt.strftime("%Y-%m-%d %H:%M:%S")
        
        return start_time
    
    except Exception as e:
        print("ERROR IN DATE FORMAT:", e)
        return "INVALID DATE FORMAT"
    

def send_sms(captured_details):
    try:
        summary=f"""
            Dear {captured_details['first_name']},

            Your meeting with Worktual Innovations has been scheduled on {captured_details['date_time']}.Our expert will reach out to you soon for further guidance.

            For any assistance:
            ✉️ sales@worktual.in
            💬 www.worktual.in

            Thank you for choosing Worktual!
            """.strip()
         
        digits = re.findall(r'\d+', captured_details['mobile_number'])
        updated_speaker_number = ''.join(digits).strip()
        if len(updated_speaker_number) > 10:
            updated_speaker_number = updated_speaker_number[-10::]
        if len(updated_speaker_number)==10:
            updated_speaker_number="91"+updated_speaker_number
            
        print(f"IN SMS SENDING FUNCTION WITH SPEAKER NUMBER : {updated_speaker_number} and first name : {captured_details['first_name']}")
            
        sms_url = "https://did.worktual.co.uk/did/v1/smsOutBot"
        sms_payload = {
        "destination": updated_speaker_number,
        "source": "447451295161",
        "content":summary}
        
        sms_response = requests.post(url= sms_url,json=sms_payload,timeout=5)
        sms_response = sms_response.json()
        print(f"SMS API RESPONSE:: {sms_response}")
        # if updated_speaker_number=="918688081926":
        #     time.sleep(20)
        if sms_response["status"] == "Success":
            return "Success"
        else:
            return "Unsuccess"
        
    except Exception as e:
        print(f"EXCEPTION IN SMS SENDING :{e}")
        return "Unsuccess"
    
def send_email(user_email,captured_details):
    try:
        sender = "verify.worktual@gmail.com"
        recipients = [user_email]
        APP_PASSWORD = "hcpg jtop eiwk pvno"
        
        subject = "Demo Confirmed – Looking Forward to Meeting You"

        body = f"""
            Dear {captured_details['first_name']},

            Your meeting with Worktual Innovations has been scheduled on {captured_details['date_time']}.Our expert will reach out to you soon for further guidance.

            For any assistance:
            📞 +91 44400 04400
            ✉️ sales@worktual.in
            💬 www.worktual.in

            Thank you for choosing Worktual!
            """.strip()

        msg = MIMEText(body, 'html')
        msg['Subject'] = subject
        msg['From'] = sender
        msg['To'] = ', '.join(recipients)
        # sender = 'nlpchatbot927@gmail.com'
        # recipients = [sender, user_email]
        # APP_PASSWORD="iyld pxkx lktw rsnt"
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as smtp_server:
            smtp_server.login(sender, APP_PASSWORD)
            smtp_server.sendmail(sender, recipients, msg.as_string())

        return "success"

    except Exception as e:
        print(f"Error sending email: {e}")
        return "failure"


''' BOOK APPOINTMENT TOOL '''

BOOK_APPOINTMENT = {
  "type": "function",
  "function": {
    "name": "BOOK_APPOINTMENT",
    "strict": True,
    "description": "Schedule a Worktual demo after first name, last name, a valid mobile number, a valid email, and a preferred date and time are captured. An existing Worktual account is not required. Do not collect company or industry for booking.",
    "parameters": {
      "type": "object",
      "properties": {
        "first_name": {
          "type": "string",
          "description": "First name of the person booking the meeting."
        },
        "last_name": {
          "type": "string",
          "description": "Last name of the person booking the meeting."
        },
        "mobile_number": {
          "type": "string",
          "description": "Mobile number with country code, such as +919876543210, or the local number when country_name is set.",
          "pattern": "^\\+?[1-9][0-9]{6,15}$"
        },
        "country_name": {
          "type": "string",
          "description": "Country name or calling code, such as India or 91. Use this when the number has no country code. When the number already includes one, repeat that country."
        },
        "email": {
          "type": "string",
          "description": "Email address of the person booking the meeting."
        },
        "preferred_datetime": {
          "type": "string",
          "description": "User's preferred date and time for the meeting. Give in the format like (10-December-2025, 2pm)"
        },
        "summary": {
          "type": "string",
          "description": "Summarize the overall conversation in the current session."
        },
        "plan_name": {
          "type": "string",
          "description": "User interested plan or product name for booking the meeting."
        }
      },
      "required": [
        "first_name",
        "last_name",
        "mobile_number",
        "country_name",
        "email",
        "preferred_datetime",
        "summary",
        "plan_name"
      ],
      "additionalProperties": False
    }
  }
}

_EMAIL_FORMAT = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")


def _validated_demo_phone(mobile: str, country_name: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    result = validate_phone_number(str(mobile or ""), country_name or None)
    if not isinstance(result, dict) or not result.get("valid"):
        if isinstance(result, dict) and result.get("needs_country"):
            return None, (
                "The mobile number needs a country code or a country name. "
                "Ask for that and a number with the right length. Do not book."
            )
        return None, (
            "The mobile number is not a valid number for that country. "
            "Ask for the country code or country name and the full number. Do not book."
        )
    return str(result["e164"]), None


def book_appointment(**kwargs):
  try:
    first_name = kwargs.get("first_name", "")
    last_name = kwargs.get("last_name", "")
    mobile_number = kwargs.get("mobile_number", "")
    email = kwargs.get("email", "")
    industry = kwargs.get("industry", "")
    company_name = kwargs.get("company_name", "")
    preferred_datetime = kwargs.get("preferred_datetime", "")
    summary = kwargs.get("summary", "")
    plan_name = kwargs.get("plan_name", "")
    cookie_id = kwargs.get("cookie_id", "")
    country_name = kwargs.get("country_name", "")

    if not email:
        return {
            "status": "success",
            "message": "Email address is missing, ask the user to provide the email address to schedule the appointment with the sales team.",
            "data": kwargs,
        }

    if not _EMAIL_FORMAT.match(str(email).strip()):
        return {
            "status": "success",
            "message": "The email format is not valid. Ask for a correct email address. Do not book.",
            "data": kwargs,
        }
    email = str(email).strip().lower()

    if not mobile_number:
        return {
            "status": "success",
            "message": "Mobile number is missing, ask the user to provide the mobile number to schedule the appointment with the sales team.",
            "data": kwargs,
        }

    normalized_mobile, phone_error = _validated_demo_phone(str(mobile_number), str(country_name or "") or None)
    if phone_error or not normalized_mobile:
        return {
            "status": "success",
            "message": phone_error,
            "data": kwargs,
        }
    mobile_number = normalized_mobile

    starts_at = preferred_datetime_to_iso(preferred_datetime)
    contact_id = cdp_contact_id_for_email(email)
    if not contact_id:
        contact_id = sync_contact_and_get_id(
            first_name,
            last_name,
            mobile_number,
            email,
            industry,
            company_name,
            cookie_id,
            summary,
            plan_name,
            preferred_datetime,
        ) or ""

    if not contact_id:
        return {
            "status": "failure",
            "message": "The demo could not be booked right now. Ask them to try again shortly.",
            "data": kwargs,
        }

    existing = _live_appointment(contact_id)
    if isinstance(existing, dict) and _appointment_is_upcoming(existing):
        return {
            "status": "success",
            "message": _existing_demo_message(existing),
            "data": {
                **kwargs,
                "contact_id": contact_id,
                "appointment_id": existing.get("id") or "",
                "join_url": existing.get("joinUrl") or "",
            },
        }
    if existing is not None and not isinstance(existing, dict):
        print("CRM LOOKUP ERROR", getattr(existing, "status_code", ""), getattr(existing, "text", ""))
        return {
            "status": "failure",
            "message": "Technical Error in booking the appointment. Please tell the user to try again later.",
            "data": kwargs,
        }

    availability = check_appointment_availability(contact_id, starts_at)
    if not availability.get("available"):
        reason = availability.get("reason", "no_slots_available")
        if reason == "appointment_exists":
            response = _existing_demo_message({})
        else:
            response = "The selected time slot is not available. Please choose another date and time within business hours."
        return {
            "status": "success",
            "message": response,
            "data": {
                **kwargs,
                "contact_id": contact_id,
                "availability_reason": reason,
            },
        }

    title = f"Product consultation — {plan_name or 'webchat'}"
    booking_response = create_crm_appointment(contact_id, title, starts_at)

    if booking_response.status_code == 409:
        conflict = booking_response.json()
        if conflict.get("code") == "appointment_exists":
            response = _existing_demo_message({})
        else:
            response = "The selected time slot is not available. Please choose another date and time within business hours."
        return {
            "status": "success",
            "message": response,
            "data": {**kwargs, "contact_id": contact_id, "code": conflict.get("code")},
        }

    if booking_response.status_code != 201:
        print("CRM BOOKING ERROR", booking_response.status_code, booking_response.text)
        return {
            "status": "failure",
            "message": "Technical Error in booking the appointment. Please tell the user to try again later.",
            "data": kwargs,
        }

    booking_data = booking_response.json()
    appointment = booking_data.get("appointment", {})
    join_url = appointment.get("joinUrl", "")
    appointment_id = appointment.get("id", "")

    captured_details = {
        "worktual_plan": plan_name,
        "first_name": first_name,
        "last_name": last_name,
        "mobile_number": mobile_number,
        "email": email,
        "company_name": company_name,
        "date_time": date_format_reschedule(preferred_datetime),
    }
    return_message = insert_scheduling_details_india(captured_details, summary)
    print("RETURN MESSAGE---> ", return_message)

    if return_message == "SUCCESS":
        response = (
            "Your appointment with our sales team is scheduled. "
            f"The Google Meet link is {join_url}. "
            "The confirmation email has been sent to your mail. "
            "Please kindly check your email. Our sales team will contact you soon. "
            "Is there anything we can assist you with at the moment?"
        )
        status = "success"
    elif return_message == "EmailId is required":
        response = "Email address is missing, ask the user to provide the email address to schedule the appointment with the sales team."
        status = "success"
    elif return_message == "Phone Number is required":
        response = "Mobile number is missing, ask the user to provide the mobile number to schedule the appointment with the sales team."
        status = "success"
    else:
        response = (
            "Your appointment with our sales team is scheduled. "
            f"The Google Meet link is {join_url}. "
            "Our sales team will contact you soon. "
            "Is there anything we can assist you with at the moment?"
        )
        status = "success"

  except Exception as e:
      print("ERROR IN APPOINTMENT BOOKING", e)
      status = "failure"
      response = "Technical issue, Our team will contact you soon."
      appointment_id = ""
      join_url = ""
      contact_id = kwargs.get("contact_id", "")

  return {
        "status": status,
        "message": response,
        "data": {
            "plan_name": plan_name,
            "first_name": first_name,
            "last_name": last_name,
            "mobile_number": mobile_number,
            "email": email,
            "company_name": company_name,
            "preferred_datetime": preferred_datetime,
            "summary": summary,
            "appointment_id": appointment_id if 'appointment_id' in locals() else "",
            "join_url": join_url if 'join_url' in locals() else "",
            "contact_id": contact_id if 'contact_id' in locals() else "",
        }
    }


RESCHEDULE_APPOINTMENT = {
  "type": "function",
  "function": {
    "name": "RESCHEDULE_APPOINTMENT",
    "strict": True,
    "description": "Collect and validate user details for rescheduling a Worktual AI meeting. Ensures email and preferred date & time are captured. If user provides time outside business hours (9 AM to 7 PM, Mon–Sat), inform them of standard hours but allow special-case rescheduling. If country code is missing in mobile_no, ask for country name or code and confirm.",
    "parameters": {
      "type": "object",
      "properties": {
        "email": {
          "type": "string",
          "description": "Email address of the person booking the meeting."
        },
        "preferred_datetime": {
          "type": "string",
          "description": "User's preferred new date and time for the meeting. Give in the format like (10-December-2025, 2pm)"
        },
        "summary": {
          "type": "string",
          "description": "Summarize the overall conversation in the current session."
        }
      },
      "required": [
        "email",
        "preferred_datetime",
        "summary"
      ],
      "additionalProperties": False
    }
  }
}

def reschedule_meeting(**kwargs):
  try:
    email = kwargs.get("email", "")
    preferred_datetime = kwargs.get("preferred_datetime", "")
    summary = kwargs.get("summary", "")
    cookie_id = kwargs.get("cookie_id", "")

    if not email:
        return {
            "status": "success",
            "message": "Email address is missing, ask the user to provide the email address to reschedule the appointment with the sales team.",
            "data": kwargs,
        }

    starts_at = preferred_datetime_to_iso(preferred_datetime)
    contact_id = cdp_contact_id_for_email(email)

    if not contact_id:
        return {
            "status": "success",
            "message": "We couldn't find a demo for that email. Ask them to confirm the email used for the booking.",
            "data": kwargs,
        }

    lookup_response = get_crm_appointment_by_contact(contact_id)
    if lookup_response.status_code == 404:
        return {
            "status": "success",
            "message": "We couldn't find any appointment associated with the provided email address. Could you please verify the email and provide a valid one?",
            "data": kwargs,
        }

    if lookup_response.status_code != 200:
        print("CRM LOOKUP ERROR", lookup_response.status_code, lookup_response.text)
        return {
            "status": "failure",
            "message": "Technical issue, Our team will contact you soon.",
            "data": kwargs,
        }

    existing_appointment = lookup_response.json().get("appointment", {})
    appointment_id = existing_appointment.get("id")
    if not appointment_id:
        return {
            "status": "success",
            "message": "We couldn't find any appointment associated with the provided email address. Could you please verify the email and provide a valid one?",
            "data": kwargs,
        }

    availability = check_appointment_availability(contact_id, starts_at)
    if not availability.get("available"):
        return {
            "status": "success",
            "message": "The selected time slot is not available. Please choose another date and time within business hours.",
            "data": {**kwargs, "contact_id": contact_id},
        }

    title = "Rescheduled — product consultation"
    reschedule_response = reschedule_crm_appointment(appointment_id, starts_at, title)

    if reschedule_response.status_code == 409:
        return {
            "status": "success",
            "message": "The selected time slot is not available. Please choose another date and time within business hours.",
            "data": {**kwargs, "contact_id": contact_id},
        }

    if reschedule_response.status_code != 200:
        print("CRM RESCHEDULE ERROR", reschedule_response.status_code, reschedule_response.text)
        return {
            "status": "failure",
            "message": "Technical issue, Our team will contact you soon.",
            "data": kwargs,
        }

    updated_appointment = reschedule_response.json().get("appointment", {})
    join_url = updated_appointment.get("joinUrl", existing_appointment.get("joinUrl", ""))
    new_date = date_format_reschedule(preferred_datetime)

    response_dict = {
        "first_name": existing_appointment.get("guestEmails", [""])[0] if existing_appointment.get("guestEmails") else "",
        "last_name": "",
        "email": email,
        "mobile_number": "",
        "company_name": "",
        "date_time": new_date,
    }
    return_message = insert_scheduling_details_india(response_dict, summary)

    if return_message in ("SUCCESS", "FAILURE"):
        response = (
            "Your appointment with our sales team has been rescheduled. "
            f"The Google Meet link is {join_url}. "
            "The confirmation email has been sent to your mail. "
            "Please kindly check your email. Our sales team will contact you soon. "
            "Is there anything we can assist you with at the moment?"
        )
    elif return_message == "EmailId is required":
        response = "Email address is missing, ask the user to provide the email address to reschedule the appointment with the sales team."
    elif return_message == "Phone Number is required":
        response = "Mobile number is missing, ask the user to provide the mobile number to reschedule the appointment with the sales team."
    else:
        response = (
            "Your appointment with our sales team has been rescheduled. "
            f"The Google Meet link is {join_url}. "
            "Our sales team will contact you soon. "
            "Is there anything we can assist you with at the moment?"
        )

    status = "success"

  except Exception as e:
      print("ERROR IN RESCHEDULE APPOINTMENT", e)
      status = "failure"
      response = "Technical issue, Our team will contact you soon."
      appointment_id = ""
      join_url = ""
      contact_id = kwargs.get("contact_id", "")

  return {
        "status": status,
        "message": response,
        "data": {
          "email": email,
          "preferred_datetime": preferred_datetime,
          "summary": summary,
          "appointment_id": appointment_id if 'appointment_id' in locals() else "",
          "join_url": join_url if 'join_url' in locals() else "",
          "contact_id": contact_id if 'contact_id' in locals() else "",
    }
  }


CANCEL_APPOINTMENT = {
  "type": "function",
  "function": {
    "name": "CANCEL_APPOINTMENT",
    "strict": True,
    "description": "Cancel the customer's live Worktual appointment. Call only when they ask to cancel. The email must already be on their account.",
    "parameters": {
      "type": "object",
      "properties": {
        "email": {
          "type": "string",
          "description": "Email address on the Worktual account."
        }
      },
      "required": ["email"],
      "additionalProperties": False
    }
  }
}


def cancel_appointment(**kwargs):
    email = str(kwargs.get("email") or "").strip()
    if not email:
        return {
            "status": "success",
            "message": "Email address is missing. Ask for the email on their Worktual account.",
            "data": kwargs,
        }
    contact_id = cdp_contact_id_for_email(email)
    if not contact_id:
        return {
            "status": "success",
            "message": "We do not have a Worktual account for that email. Do not cancel.",
            "data": kwargs,
        }
    existing = _live_appointment(contact_id)
    if existing is None:
        return {
            "status": "success",
            "message": "There is no live appointment to cancel.",
            "data": {**kwargs, "contact_id": contact_id},
        }
    if not isinstance(existing, dict):
        return {
            "status": "failure",
            "message": "The appointment could not be canceled right now. Ask them to try again shortly.",
            "data": kwargs,
        }
    appointment_id = existing.get("id")
    canceled = cancel_crm_appointment(appointment_id)
    if canceled.status_code != 200:
        print("CRM CANCEL ERROR", canceled.status_code, canceled.text)
        return {
            "status": "failure",
            "message": "The appointment could not be canceled right now. Ask them to try again shortly.",
            "data": {**kwargs, "contact_id": contact_id, "appointment_id": appointment_id},
        }
    return {
        "status": "success",
        "message": "The live appointment is canceled.",
        "data": {**kwargs, "contact_id": contact_id, "appointment_id": appointment_id},
    }


GET_SALES_KNOWLEDGE = {
  "type": "function",
  "function": {
    "name": "GET_SALES_KNOWLEDGE",
    "strict": False,
    "description": "Look up Worktual products before answering. Call this for any question about Lola, Worktual, or products. Say only the returned text. If it is empty, say you do not have that detail.",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
            "oneOf": [
                { "type": "string" },
                { "type": "array", "items": { "type": "string" } }
            ],
            "description": "Search query. Pass empty string when only fetching facet counts."
        }
      },
      "required": ["query"]
    }
  }
}

def _knowledge_query_text(query) -> str:
    if isinstance(query, list):
        return " ".join(str(item).strip() for item in query if str(item).strip())
    return str(query or "").strip()


def _sales_organization_id(kwargs: dict) -> str:
    organization_id = str(kwargs.get("organization_id") or kwargs.get("domainId") or "").strip()
    if organization_id:
        return organization_id
    session_id = str(kwargs.get("session_id") or "").strip()
    if not session_id:
        return ""
    return str(get_turn_context(session_id).get("organization_id") or "").strip()


def _search_business_knowledge(query: str, organization_id: str) -> dict:
    import asyncio
    from concurrent.futures import ThreadPoolExecutor

    from app.services.knowledge_search import search_knowledge_gateway

    coroutine = search_knowledge_gateway(
        query,
        organization_id=organization_id,
        module="business",
    )
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coroutine)
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coroutine).result()


def get_sales_knowledge(query, limit=2, **kwargs):
  """Search Setup business knowledge. `limit` is unused; the gateway result count comes from settings."""
  del limit
  text = _knowledge_query_text(query)
  organization_id = _sales_organization_id(kwargs)
  if not text or not organization_id:
      return {
          "status": "failure",
          "message": "The product lookup failed. Tell the customer you do not have that detail. Do not invent products.",
          "data": {"query": query, "result": "Some technical issue."},
      }
  try:
    result = _search_business_knowledge(text, organization_id)
    snippets = result.get("results") or []
    context = "\n".join(
        str(item.get("text") or "").strip()
        for item in snippets
        if isinstance(item, dict) and str(item.get("text") or "").strip()
    )
    if not context.strip():
        return {
            "status": "success",
            "query": text,
            "context": "",
            "message": "No product detail was found. Tell the customer you do not have that detail. Do not invent products.",
        }
    return {
       "status":"success",
       "query" : text,
       "context":context
    }
  except Exception as e:
      print("Exception in Knowledge Base: ",e)
      return {
          "status": "failure",
          "message": "The product lookup failed. Tell the customer you do not have that detail. Do not invent products.",
          "data": {
              "query": query,
              "result": "Some technical issue."
          }
      }



"===================================================== SERVICE TOOLS =============================================================="

''' SERVICE KNOWLEDGE BASE TOOL '''

GET_SERVICE_KNOWLEDGE = {
  "type": "function",
  "function": {
    "name": "GET_SERVICE_KNOWLEDGE",
    "strict": False,
    "description": "Fetch relevant information from the knowledge base based on the user's query.",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
            "oneOf": [
                { "type": "string" },
                { "type": "array", "items": { "type": "string" } }
            ],
            "description": "Search query. Pass empty string when only fetching facet counts."
        }
      },
      "required": ["query"]
    }
  }
}

def get_service_knowledge(query, limit=2, **kwargs):
  try:
    payload = {
            "query": query,
            "domain_id": "worktual_service_kb",
            "filter": [],
            "facets": [],
            "limit": limit
            }
    url = get_settings().custom_lola_worktual_kb_retrieve_url.strip()
    result = requests.post(url, json=payload).json()
    context = ""
    for i in result.get("hits") or []:
       context += i.get("text") or ""
    if not context.strip():
        return {
            "status": "success",
            "query": query,
            "context": "",
            "message": "No service detail was found. Say that information is unavailable. Do not invent it.",
        }
    return {
       "status":"success",
       "query" : query,
       "context":context
    }
  except Exception as e:
      print("Exception in Knowledge Base: ",e)
      return {
          "status": "failure",
          "data": {
              "query": query,
              "result": "Some technical issue."
          }
      }

''' OTP TOOLS '''

def get_user_det_pass(mobile):
    return []


SEND_OTP = {
  "type": "function",
  "function": {
    "name": "SEND_OTP",
    "strict": True,
    "description": "Send one code to a stored Worktual email or phone after the customer is found. One success covers this chat. Do not send the other medium. Claim a send only when sent is true.",
    "parameters": {
      "type": "object",
      "properties": {
        "option": {
          "type": "string",
          "enum": ["email", "mobile"],
          "description": "User-selected contact method to receive OTP"
        },
        "mobile": {
          "type": "string",
          "description": "OTP destination mobile number with country code. Required only when option is mobile.Do not add any space between the numbers.first try to fetch from the current convo else ask it from the user.",
          "pattern": "^[1-9][0-9]{7,15}$"
        },
        "email": {
          "type": "string",
          "description": "OTP destination email address. Required only when option is email, before collecting the mail from the user check is there is any mail id present in the current conversation.",
          "format": "email"
        }
      },
      "required": ["option"],
      "additionalProperties": False
    }
  }
}



def set_otp(session_id,otp):
  OTP_MANAGER[session_id] = otp

def get_otp(session_id):
  res = OTP_MANAGER[session_id]
  return res

def send_otp_email(user_email,otp_code,first_name):
    try:
        sender = "verify.worktual@gmail.com"
        recipients = [user_email]
        APP_PASSWORD = "hcpg jtop eiwk pvno"
        
        subject = "OTP FOR ACCOUNT VERIFICATION"

        body = f"""
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #000; margin:0; padding:0;">
            <div style="max-width:600px; margin:auto; border:1px solid #ddd;">
               
               
                <!-- Black bar -->
                <div style="background-color:#000; color:#fff; text-align:center;display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;">
                     <img src='https://worktual.co.uk/whitelogonew.png'https://worktual.co.uk/whitelogonew.png alt='worktuallogo' style="width: 180px"/>
                </div>
               
                <div style="padding:20px;">
                    <h3 style="text-align: center; font-size:20px;margin:0px">OTP Verification</h3>
                    <h3 style="font-size: 18px;">Dear {first_name},</h3>
                    <p style="font-size: 16px;">We received a request to verify your Worktual Account.</p>
                    <p style="font-size: 16px;">Please use the following One-Time Password (OTP) to continue:</p>

                    <p style="font-size:24px; font-weight:bold; text-align:center; letter-spacing:4px; margin:20px 0;">
                        {otp_code}
                    </p>

                    <p style="font-size: 16px;">If you didn't request this verification, please ignore this email or contact our Support team immediately.</p>

                    <p style="font-size: 16px;">Thanks,<br>Team Worktual</p>

                    <hr>
                    <p style="font-size:12px; color:#555;margin: 16px 0px 0px;">
                        For assistance, email us at
                        <a href="mailto:support@worktual.in">support@worktual.in</a>
                        or chat with us at <a href="https://www.worktual.in">www.worktual.in</a>.
                    </p>
                </div>
            </div>
        </body>
        </html>
        """

        msg = MIMEText(body, 'html')
        msg['Subject'] = subject
        msg['From'] = sender
        msg['To'] = ', '.join(recipients)
        # sender = 'nlpchatbot927@gmail.com'
        # recipients = [sender, user_email]
        # APP_PASSWORD="iyld pxkx lktw rsnt"
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as smtp_server:
            smtp_server.login(sender, APP_PASSWORD)
            smtp_server.sendmail(sender, recipients, msg.as_string())

        return "success"

    except Exception as e:
        print(f"Error sending email: {e}")
        return "failure"

def send_otp_sms(mobile,otp,first_name):
  try:
      summary=f""" Hello! {first_name},
      {otp} is your OTP to authenticate worktual account.""".strip()
          
      digits = re.findall(r'\d+', mobile)
      updated_speaker_number = ''.join(digits).strip()
      if len(updated_speaker_number) > 10:
          updated_speaker_number = updated_speaker_number[-10::]
      if len(updated_speaker_number)==10:
          updated_speaker_number="91"+updated_speaker_number
          
      print(f"IN SMS SENDING FUNCTION WITH SPEAKER NUMBER : {updated_speaker_number}")
      
      sms_url = "https://did.worktual.co.uk/sms/v1/infobip/smsOutBot"
      sms_payload = {
      "destination": updated_speaker_number,
      "source": "447451295161",
      "content":summary}
      
      sms_response = requests.post(url= sms_url,json=sms_payload,timeout=5)
      sms_response = sms_response.json()
      print(f"SMS API RESPONSE:: {sms_response}")
      # if updated_speaker_number=="918688081926":
      #     time.sleep(20)
      if sms_response["status"] == "Success":
          return "success"
      else:
          return "failure"
      
  except Exception as e:
      print(f"EXCEPTION IN SMS SENDING :{e}")
      return "failure"

def account_verification(**kwargs):
    from app.agents.custom_lola_worktual.identity import send_session_otp

    session_id = str(kwargs.get("session_id") or "")
    try:
        return send_session_otp(
            session_id,
            option=str(kwargs.get("option") or ""),
            email=str(kwargs.get("email") or ""),
            mobile=str(kwargs.get("mobile") or ""),
        )
    except Exception as exc:
        print("ERROR IN ACCOUNT VERIFICATION : ", exc)
        return {"status": "failure", "sent": False, "message": "Some technical Issue."}


''' VERIFY OTP TOOL '''

VERIFY_OTP = {
  "type": "function",
  "function": {
    "name": "VERIFY_OTP",
    "strict": True,
    "description": "Check the one code the customer received. One success covers the rest of this chat. Do not ask for another medium.",
    "parameters": {
      "type": "object",
      "properties": {
        "otp": {
          "type": "integer",
          "description": "The OTP entered by the user."
        }
      },
      "required": ["otp"],
      "additionalProperties": False
    }
  }
}


def verify_otp(otp,**kwargs):
    from app.agents.custom_lola_worktual.identity import verify_session_otp

    session_id = str(kwargs.get("session_id") or "")
    try:
        return verify_session_otp(session_id, otp)
    except Exception as exc:
        print("ERROR IN VERIFY OTP : ", exc)
        return {"status": "failure", "authenticated": False, "message": "Some technical Issue."}


''' TICKETING  TOOLS '''
country_timezone_map = {
    "India": "Asia/Kolkata",
    "United States": "America/New_York",   # or "America/Los_Angeles", etc.
    "Australia": "Australia/Sydney",
    "United Kingdom": "Europe/London",
    "Japan": "Asia/Tokyo",
    "Russia": "Europe/Moscow",
    "UAE": "Asia/Dubai",
    "Germany": "Europe/Berlin",
    "South Africa": "Africa/Johannesburg"
}

def get_time_by_country_for_ticket(country_name):
    try:
        tz_name = country_timezone_map[country_name]
        timezone = pytz.timezone(tz_name)
        country_time = datetime.datetime.now(timezone)
        return f"{country_time.strftime('%d-%m-%Y %I:%M %p')}"
    except KeyError:
        return f"Country '{country_name}' is not in the timezone map."
    except Exception as e:
        return f"Error: {str(e)}"

def send_mail_ticket(user_email, first_name, ticket_id, issue_subject, date_time_1):
  try:
      content = f"""
      Hi <b>{first_name}</b>,<br><br>

      We’ve received your request, and a support ticket has been created with the following details:<br><br>

      <b>Ticket ID:</b> {ticket_id}<br>
      <b>Issue:</b> {issue_subject}<br>
      <b>Created On:</b> {date_time_1}<br><br>

      Our support team is currently reviewing your concern and will get back to you.
      If additional information is required, we’ll contact you using this email address.<br><br>

      You can track the status of your ticket or add more details by replying to this email or visiting our portal: <a href="https://support.worktual.in">support.worktual.in</a><br><br>

      Warm regards,<br>
      <b>Worktual Team</b>
      """

      sender = "notifications.worktual@gmail.com"
      recipients = [user_email]
      APP_PASSWORD = "ejua szvv kohq bzlr"

      subject = f"TICKET CREATED for {issue_subject}"

      msg = MIMEText(content, "html", "utf-8")
      msg["Subject"] = subject
      msg["From"] = sender
      msg["To"] = user_email

      with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp_server:
          smtp_server.login(sender, APP_PASSWORD)
          smtp_server.sendmail(sender, recipients, msg.as_string())

      return "success"

  except Exception as e:
      print(f"Error sending email: {e}")
      return "failure"

VERIFY_CONTACT_FOR_TICKET = {
  "type": "function",
  "function": {
    "name": "VERIFY_CONTACT_FOR_TICKET",
    "strict": True,
    "description": "Verify the customer exists in CDP before creating or checking tickets. Call when the user wants ticket support.",
    "parameters": {
      "type": "object",
      "properties": {
        "email": {
          "type": "string",
          "description": "Customer email if known"
        },
        "mobile": {
          "type": "string",
          "description": "Customer mobile if known"
        }
      },
      "required": [],
      "additionalProperties": False
    }
  }
}


def verify_contact_for_ticket(**kwargs):
    from app.agents.custom_lola_worktual.identity import lookup_worktual_customer

    session_id = str(kwargs.get("session_id") or "")
    context = get_turn_context(session_id)
    contact_profile = context.get("contact_profile") or {}
    email = kwargs.get("email") or contact_profile.get("primaryEmail") or contact_profile.get("primary_email") or ""
    mobile = kwargs.get("mobile") or contact_profile.get("primaryPhone") or contact_profile.get("primary_phone") or ""
    found = lookup_worktual_customer(session_id, str(email or ""), str(mobile or ""))
    if found.get("found"):
        customer = found.get("customer") or {}
        set_verified_contact(
            session_id,
            {
                "contact_id": found.get("cdp_id") or contact_profile.get("contactId"),
                "email": customer.get("email") or email,
                "mobile": customer.get("phone") or mobile,
                "first_name": customer.get("name") or contact_profile.get("firstName") or "",
            },
        )
        return {
            "status": "success",
            "message": "This person is a Worktual customer. Send one OTP. Do not verify twice.",
            "data": {"verified": False, "customer_found": True},
        }
    return {
        "status": "success",
        "message": found.get("message") or "We could not find that Worktual customer.",
        "data": {"verified": False, "customer_found": False},
    }


CONTACT_ENRICH = {
  "type": "function",
  "function": {
    "name": "contact_enrich",
    "strict": True,
    "description": (
      "Save contact details the customer stated. A blank email or phone is saved. "
      "An email or phone that already belongs to another contact is not. "
      "Claim only appliedFields."
    ),
    "parameters": {
      "type": "object",
      "properties": {
        "email": {"type": "string", "description": "Email explicitly provided by the customer"},
        "phone": {"type": "string", "description": "Phone explicitly provided by the customer"},
        "firstName": {"type": "string", "description": "First name explicitly provided by the customer"},
        "lastName": {"type": "string", "description": "Last name explicitly provided by the customer"},
        "displayName": {"type": "string", "description": "Full name explicitly provided by the customer"},
        "company": {"type": "string", "description": "Company explicitly provided by the customer"},
        "city": {"type": "string", "description": "City explicitly provided by the customer"},
        "country": {"type": "string", "description": "Country explicitly provided by the customer"},
        "confirmedFields": {
          "type": "array",
          "description": "Fields the customer explicitly approved replacing after a conflict",
          "items": {
            "type": "string",
            "enum": [
              "email", "phone", "firstName", "lastName",
              "displayName", "company", "city", "country"
            ]
          }
        }
      },
      "required": [],
      "additionalProperties": False
    }
  }
}


def contact_enrich(**kwargs):
    session_id = str(kwargs.get("session_id") or "")
    context = get_turn_context(session_id)
    organization_id = str(context.get("organization_id") or "")
    conversation_id = str(context.get("conversation_id") or session_id)
    fields = {
        key: value.strip()
        for key, value in {
            "email": kwargs.get("email"),
            "phone": kwargs.get("phone"),
            "firstName": kwargs.get("firstName"),
            "lastName": kwargs.get("lastName"),
            "displayName": kwargs.get("displayName"),
            "company": kwargs.get("company"),
            "city": kwargs.get("city"),
            "country": kwargs.get("country"),
        }.items()
        if isinstance(value, str) and value.strip()
    }
    confirmed_fields = list(dict.fromkeys(kwargs.get("confirmedFields") or []))

    if not organization_id or not conversation_id:
        return {
            "ok": False,
            "error": "missing_conversation_context",
            "appliedFields": [],
            "requiresConfirmation": [],
        }
    if not fields:
        return {
            "ok": False,
            "error": "no_contact_fields",
            "appliedFields": [],
            "requiresConfirmation": [],
        }

    settings = get_settings()
    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "x-tenant-id": organization_id,
    }
    if settings.internal_service_key:
        headers["x-internal-service-key"] = settings.internal_service_key

    try:
        response = requests.post(
            (
                f"{settings.cc_core_url.rstrip('/')}/internal/v1/conversations/"
                f"{conversation_id}/contact/enrich"
            ),
            headers=headers,
            json={
                "contactEntities": fields,
                "confirmedFields": confirmed_fields,
            },
            timeout=settings.cc_core_timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException:
        return {
            "ok": False,
            "error": "contact_enrichment_unavailable",
            "appliedFields": [],
            "requiresConfirmation": [],
        }
    except ValueError:
        return {
            "ok": False,
            "error": "invalid_contact_enrichment_response",
            "appliedFields": [],
            "requiresConfirmation": [],
        }

    result = payload.get("result") if isinstance(payload, dict) else None
    if not isinstance(result, dict):
        return {
            "ok": False,
            "error": "empty_contact_enrichment_result",
            "appliedFields": [],
            "requiresConfirmation": [],
        }

    contact = result.get("contact")
    if isinstance(contact, dict):
        context["contact_profile"] = contact
        set_verified_contact(
            session_id,
            {
                "contact_id": result.get("canonicalContactId") or contact.get("id"),
                "email": contact.get("primaryEmail") or contact.get("email"),
                "mobile": contact.get("primaryPhone") or contact.get("phone"),
                "first_name": contact.get("firstName") or "",
            },
        )

    return {
        "ok": True,
        "outcome": result.get("outcome"),
        "canonicalContactId": result.get("canonicalContactId"),
        "appliedFields": result.get("appliedFields") or [],
        "skippedFields": result.get("skippedFields") or [],
        "requiresConfirmation": result.get("requiresConfirmation") or [],
        "contact": contact,
    }


CREATE_TICKET = {
  "type": "function",
  "function": {
    "name": "CREATE_TICKET",
    "strict": True,
    "description": "Open a ticket only after one OTP in this chat and only when troubleshooting did not solve the issue or the customer is not satisfied. Do not send priority. Do not ask for a second code.",
    "parameters": {
      "type": "object",
      "properties": {
        "summary": {
          "type": "string",
          "description": "Detailed summary of the issue or request."
        }
      },
      "required": ["summary"],
      "additionalProperties": False
    }
  }
}


def create_ticket(summary,**kwargs):
    import hashlib

    from app.agents.custom_booxoo_bot.clients.ticketing import TicketingClient
    from app.agents.custom_lola_worktual.session_card import get_chat_state, save_lola_card

    session_id = str(kwargs.get("session_id", ""))
    state = get_chat_state(session_id)
    if not state.authenticated:
        return {
            "status": "success",
            "message": "We couldn't create a ticket because we don't have your contact details yet. Please verify your contact first.",
            "data": {"summary": summary},
        }
    email = state.contact.get("email") or ""
    mobile = state.contact.get("phone") or ""
    name = state.contact.get("name") or (email.split("@")[0] if email else "Customer")
    issue = str(summary or "").strip()
    context = get_turn_context(session_id)
    channel = str(context.get("channel") or "webchat")
    issue_key = hashlib.sha256(issue.encode()).hexdigest()[:16]
    external_ref = session_id
    try:
        status_code, payload = TicketingClient().create_ticket(
            name=name,
            issue=issue,
            email=email,
            mobile=mobile,
            external_ref=external_ref,
            idempotency_key=f"{external_ref}:{issue_key}" if external_ref else issue_key,
            metadata={"source": "ccaas_bot", "conversationId": session_id},
            subject=issue[:80],
            channel=channel,
        )
    except Exception as exc:
        print("Exception in create ticket: ", exc)
        return {"status": "failure", "message": "Some technical Issue.", "data": {"summary": summary}}
    if status_code in (200, 201) and isinstance(payload, dict):
        ticket = payload.get("ticket") if isinstance(payload.get("ticket"), dict) else payload
        number = ticket.get("ticketNumber") or ticket.get("ticket_number") or ticket.get("id")
        state.last_ticket = {"ticketNumber": number, "status": ticket.get("status")}
        save_lola_card(str(context.get("organization_id") or ""), session_id, state)
        response = (
            f"We've raised a ticket for you. Your ticket number is {number}. "
            "The team will contact you shortly."
            if number
            else "We've raised a ticket for you. The team will contact you shortly."
        )
        return {"status": "success", "message": response, "data": {"summary": summary, "ticketNumber": number}}
    if status_code == 409:
        return {
            "status": "success",
            "message": "A ticket for this request already exists. Do not create another.",
            "data": {"summary": summary},
        }
    return {
        "status": "success",
        "message": "We couldn't create your ticket right now. Do not claim it was opened.",
        "data": {"summary": summary, "http_status": status_code},
    }



GET_TICKET_STATUS = {
  "type": "function",
  "function": {
    "name": "GET_TICKET_STATUS",
    "strict": True,
    "description": "Look up this customer's tickets after this chat is verified once. Do not troubleshoot a status check. Do not ask for another code.",
    "parameters": {
      "type": "object",
      "properties": {
        "ticket_id": {
          "type": "string",
          "description": "ticket ID given by the user"
        }
      },
      "required": [],
      "additionalProperties": False
    }
  }
}


def get_ticket_status(ticket_id="",**kwargs):
    from app.agents.custom_booxoo_bot.clients.ticketing import TicketingClient
    from app.agents.custom_lola_worktual.session_card import get_chat_state

    session_id = str(kwargs.get("session_id", ""))
    state = get_chat_state(session_id)
    if not state.authenticated:
        return {
            "status": "success",
            "message": "We're sorry, but we're unable to find your ticket details. Please verify your contact first.",
            "data": {"ticket_id": ticket_id},
        }
    email = state.contact.get("email") or ""
    mobile = state.contact.get("phone") or ""
    try:
        status_code, payload = TicketingClient().lookup(email=email, mobile=mobile)
    except Exception as exc:
        print("Exception in get ticket status: ", exc)
        return {"status": "failure", "message": "Some technical Issue.", "data": {"ticket_id": ticket_id}}
    tickets = (payload.get("tickets") or []) if isinstance(payload, dict) else []
    if ticket_id:
        tickets = [
            ticket for ticket in tickets
            if str(ticket.get("ticketNumber") or ticket.get("ticket_id") or ticket.get("id") or "") == str(ticket_id)
        ] or tickets
    if status_code != 200 or not tickets:
        response = "No tickets were found for this customer."
    elif len(tickets) == 1:
        ticket = tickets[0]
        number = ticket.get("ticketNumber") or ticket.get("ticket_id") or ticket.get("id")
        response = f"Ticket {number}: {ticket.get('status') or 'unknown'}"
    else:
        response = "\n".join(
            f"Ticket {ticket.get('ticketNumber') or ticket.get('ticket_id') or ticket.get('id')}: {ticket.get('status') or 'unknown'}"
            for ticket in tickets
        )
    return {
        "status": "success",
        "message": response,
        "data": {
            "ticket_id": ticket_id
        }
    }



"------- LIVE AGENT ----------------"
LIVE_AGENT = {
  "type": "function",
  "function": {
    "name": "LIVE_AGENT",
    "strict": True,
    "description": "To connect with live agents",
    "parameters": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": False
  }
}
}

def live_agent(**kwargs):
  return {
      "status": "success",
      "handoff_recommended": True,
      "reason": "explicit_request",
      "message": "Please hold while I connect you with a live agent.",
      "data": {},
  }

" ------------------------ CALL BACK -----------------------"

CALL_BACK = {
  "type": "function",
  "function": {
    "name": "CALL_BACK",
    "strict": True,
    "description": "Collect and validate user details for call back from agent. Ensures name, mobile_nnumber with country code,email.",
    "parameters": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "description": "name of the user for agent call back"
        },
        "mobile_number": {
          "type": "string",
          "description": "Mobile number including country code. No special characters or space.",
          "pattern": "^[1-9][0-9]{6,15}$"
        },
        "email": {
          "type": "string",
          "description": "Email address of the person booking the meeting."
        },
      },
      "required": [
        "name",
        "mobile_number",
        "email"
      ],
      "additionalProperties": False
  }
}
}

def call_back(name,mobile_number,email,coid,session_id,domainId,chat_history_id,chat_duration_history_id,**kwargs):
    try:
        context = get_turn_context(str(session_id))
        organization_id = str(context.get("organization_id") or "")
        conversation_id = str(context.get("conversation_id") or session_id)
        summary = f"Callback requested for {name} ({email}, {mobile_number})"
        result = request_bot_callback(
            organization_id,
            conversation_id,
            summary=summary,
            notes=f"Mobile: {mobile_number}",
        )
        task_id = result.get("taskId") or result.get("task_id")
        message = (
            f"Thank you! We've scheduled a callback for you. Reference: {task_id}."
            if task_id
            else "Thank you! We've noted your callback request. Our team will contact you shortly."
        )
        return {
            "status": "success",
            "message": message,
            "data": {"name": name, "mobile_number": mobile_number, "email": email},
        }
    except Exception as e:
        print("Exception in CALL BACK : ", e)
        return {"status": "failure", "message": "Some technical Issue."}

'''  CALENDER TOOL  '''
CALENDAR_TOOL = {
  "type": "function",
  "function": {
    "name": "CALENDAR_TOOL",
    "description": "Parses and validates natural language date and time phrases provided by the user for scheduling or booking. Call this tool whenever a user suggests a preferred date, day, week, or time (e.g., 'tomorrow at 4pm', 'next wednesday', '3rd week of march', 'next working day'). It converts the input into a structured DD-MM-YYYY format and automatically validates whether the requested time has already passed.",
    "parameters": {
      "type": "object",
      "properties": {
        "phrase": {
          "type": "string",
          "description": "The natural language date and time phrase extracted from the user's prompt (e.g., 'next tuesday afternoon 4', 'last day of april morning 2', 'tomorrow noon')."
        },
        "reference_time_str": {
          "type": "string",
          "description": "The current date and time formatted as 'Weekday, DD Month YYYY, HH:MM am/pm' (e.g., 'Tuesday, 11 March 2026, 9:30 pm'). If omitted, the system will use the current server time."
        }
      },
      "required": ["phrase"]
    }
  }
}

def calendar_tool(phrase, **kwargs):
    try:
        reference_time_str= kwargs["formatted_time"]
        if reference_time_str:
            formats = [
                "%A, %d %B %Y, %I:%M %p",
                "%A, %d %B %Y, %H:%M %p",
                "%A, %d %B %Y, %H:%M"
            ]
            now_time = None
            for fmt in formats:
                try:
                    now_time = datetime.datetime.strptime(reference_time_str, fmt)
                    break
                except ValueError:
                    continue
            if now_time is None:
                return {
                    "status": "failure",
                    "message": f"Could not parse reference time string: '{reference_time_str}'",
                    "user_input": phrase,
                    "date": "",
                    "time": ""
                }
        else:
            now_time = datetime.datetime.now()
        
        now_date = now_time.date()
        calendar.setfirstweekday(calendar.MONDAY)
        phrase_lower = phrase.lower().strip()
    
        number_map = {
            'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
            'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5, 'last': -1,
            '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5
        }
    
        month_map = {
            'jan': 1, 'january': 1, 'feb': 2, 'february': 2, 'mar': 3, 'march': 3, 'apr': 4, 'april': 4,
            'may': 5, 'jun': 6, 'june': 6, 'jul': 7, 'july': 7, 'aug': 8, 'august': 8, 'sep': 9, 'september': 9,
            'oct': 10, 'october': 10, 'nov': 11, 'november': 11, 'dec': 12, 'december': 12
        }
    
        weekdays = {'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3, 'friday': 4, 'saturday': 5, 'sunday': 6}

        month_number_map = {
            "1st month": "january", "2nd month": "february", "3rd month": "march", "4th month": "april",
            "5th month": "may", "6th month": "june", "7th month": "july", "8th month": "august",
            "9th month": "september", "10th month": "october", "11th month": "november", "12th month": "december"
        }

        day_translations = {
            r'\bfirst day\b': "monday", r'\b1st day\b': "monday",
            r'\bsecond day\b': "tuesday", r'\b2nd day\b': "tuesday",
            r'\bthird day\b': "wednesday", r'\b3rd day\b': "wednesday",
            r'\bfourth day\b': "thursday", r'\b4th day\b': "thursday",
            r'\bfifth day\b': "friday", r'\b5th day\b': "friday",
            r'\bsixth day\b': "saturday", r'\b6th day\b': "saturday",
            r'\bseventh day\b': "sunday", r'\b7th day\b': "sunday"
        }

        for k, v in month_number_map.items():
            phrase_lower = phrase_lower.replace(k, v)

        if "week" in phrase_lower and "working" not in phrase_lower:
            for k, v in day_translations.items():
                phrase_lower = re.sub(k, v, phrase_lower)

        period_today_map = {
            "tonight": "today night",
            "this morning": "today morning",
            "this evening": "today evening",
            "this afternoon": "today afternoon",
        }
        for k, v in period_today_map.items():
            if k in phrase_lower:
                phrase_lower = phrase_lower.replace(k, v)

        phrase_lower = phrase_lower.replace("upcoming", "next").replace("coming", "next")
        phrase_lower = re.sub(r'\b(' + '|'.join(weekdays.keys()) + r')\s+(next|this)\s+week\b', r'\2 week \1', phrase_lower)
    
        if "last day" in phrase_lower:
            has_month = "month" in phrase_lower or any(m in phrase_lower for m in month_map.keys())
            if not has_month or ("week" in phrase_lower and "working" not in phrase_lower):
                phrase_lower = phrase_lower.replace("last day", "sunday")

        phrase_lower = re.sub(r'([a-zA-Z])(\d{4})', r'\1 \2', phrase_lower)
        phrase_lower = re.sub(r'\b(\d{1,2})(st|nd|rd|th)\b', r'\1', phrase_lower)

        extracted_time_str = ""
        extracted_time_obj = None
        phrase_clean_for_date = phrase_lower
    
        period_map = {"morning": "am", "afternoon": "pm", "evening": "pm", "night": "pm", "noon": "pm", "midnight": "am"}
        detected_period = next((period_map[k] for k in period_map if k in phrase_lower), None)
    
        time_match_str = None
        hour, minute, period = 0, 0, detected_period
    
        ampm_pattern = re.search(r'\b(\d{1,2})(?:[:.](\d{1,2}))?\s*(am|pm)\b', phrase_lower)
        colon_pattern = re.search(r'\b([01]?\d|2[0-3])[:.](\d{2})\b', phrase_lower)
        at_pattern = re.search(r'\bat\s+([01]?\d|2[0-3])\b', phrase_lower)
        period_num = re.search(r'\b(?:morning|afternoon|evening|night)\s+([01]?\d|2[0-3])\b', phrase_lower)
        num_period = re.search(r'\b([01]?\d|2[0-3])\s+(?:morning|afternoon|evening|night)\b', phrase_lower)
        stand_24 = re.search(r'\b(1[3-9]|2[0-3])\b', phrase_lower)
    
        if ampm_pattern:
            hour = int(ampm_pattern.group(1))
            minute = int(ampm_pattern.group(2)) if ampm_pattern.group(2) else 0
            period = ampm_pattern.group(3)
            time_match_str = ampm_pattern.group(0)
        elif colon_pattern:
            hour = int(colon_pattern.group(1))
            minute = int(colon_pattern.group(2))
            time_match_str = colon_pattern.group(0)
        elif at_pattern:
            hour = int(at_pattern.group(1))
            time_match_str = at_pattern.group(0)
        elif period_num:
            hour = int(period_num.group(1))
            time_match_str = period_num.group(0)
        elif num_period:
            hour = int(num_period.group(1))
            time_match_str = num_period.group(0)
        elif stand_24:
            hour = int(stand_24.group(1))
            time_match_str = stand_24.group(0)
        
        if time_match_str:
            if period and hour <= 12:
                if period == "pm" and hour < 12:
                    hour += 12
                elif period == "am" and hour == 12:
                    hour = 0
            extracted_time_obj = datetime.time(hour, minute)
            extracted_time_str = extracted_time_obj.strftime("%I:%M %p")
            phrase_clean_for_date = phrase_clean_for_date.replace(time_match_str, " ", 1)
    
        if not extracted_time_obj:
            if "noon" in phrase_lower:
                extracted_time_obj = datetime.time(12, 0)
                extracted_time_str = "12:00 PM"
                phrase_clean_for_date = phrase_clean_for_date.replace("noon", " ", 1)
            elif "midnight" in phrase_lower:
                extracted_time_obj = datetime.time(0, 0)
                extracted_time_str = "12:00 AM"
                phrase_clean_for_date = phrase_clean_for_date.replace("midnight", " ", 1)

        parsed_date = None
        target_year = now_date.year
        year_match = re.search(r'\b(\d{4})\b', phrase_clean_for_date)
        if year_match:
            target_year = int(year_match.group(1))

        def is_date_strictly_past(candidate_date):
            return candidate_date < now_date

        def is_datetime_past(candidate_date):
            if candidate_date < now_date:
                return True
            if candidate_date == now_date and extracted_time_obj:
                return extracted_time_obj < now_time.time()
            return False

        def get_nth_occurrence_of_weekday(y, m, n_str, wd):
            m_cal = calendar.monthcalendar(y, m)
            if n_str in ['last', 'final']:
                for week in reversed(m_cal):
                    if week[wd] != 0:
                        return datetime.date(y, m, week[wd])
            else:
                n_num = int(n_str) if str(n_str).isdigit() else number_map.get(n_str, 1)
                count = 0
                for week in m_cal:
                    if week[wd] != 0:
                        count += 1
                        if count == n_num:
                            return datetime.date(y, m, week[wd])
            return None

        t_month = now_date.month
        t_year = target_year
        month_specified = False

        if re.search(r'\b(next|coming)\s+month\b', phrase_clean_for_date):
            t_month += 1
            if t_month > 12:
                t_month -= 12
                t_year += 1
            month_specified = True
        elif re.search(r'\b(last|previous)\s+month\b', phrase_clean_for_date):
            t_month -= 1
            if t_month < 1:
                t_month += 12
                t_year -= 1
            month_specified = True
        elif re.search(r'\bthis\s+month\b', phrase_clean_for_date):
            month_specified = True
        else:
            m_match = re.search(r'\b(' + '|'.join(month_map.keys()) + r')\b', phrase_clean_for_date)
            if m_match:
                t_month = month_map[m_match.group(1)]
                month_specified = True

        temp_phrase = re.sub(r'\b(of\s+)?(this|next|last|previous|the)\s+month\b', '', phrase_clean_for_date).strip()
        temp_phrase = re.sub(r'\bof\b', '', temp_phrase).strip()

        if not parsed_date:
            if re.search(r'\bnext\s+(working day|weekday)\b', temp_phrase):
                days_ahead = 1
                candidate = now_date + datetime.timedelta(days=days_ahead)
                while candidate.weekday() > 4:
                    days_ahead += 1
                    candidate = now_date + datetime.timedelta(days=days_ahead)
                parsed_date = candidate

        if not parsed_date:
            if re.search(r'\b(last|previous)\s+(working day|weekday)\b', temp_phrase) and not month_specified and "week" not in temp_phrase:
                days_behind = 1
                candidate = now_date - datetime.timedelta(days=days_behind)
                while candidate.weekday() > 4:
                    days_behind += 1
                    candidate = now_date - datetime.timedelta(days=days_behind)
                parsed_date = candidate

        if not parsed_date:
            weekend_match = re.search(r'\b(this|next|last|coming|previous)\s+weekend\b', temp_phrase)
            if weekend_match:
                direction = weekend_match.group(1)
                today_wd = now_date.weekday()
                this_saturday = now_date + datetime.timedelta(days=(5 - today_wd))
            
                if direction in ['this', 'coming']:
                    candidate = this_saturday
                    if is_datetime_past(candidate): candidate += datetime.timedelta(days=7)
                    parsed_date = candidate
                elif direction == 'next':
                    parsed_date = this_saturday + datetime.timedelta(days=7)
                elif direction in ['last', 'previous']:
                    parsed_date = this_saturday - datetime.timedelta(days=7)

        if not parsed_date:
            workday_match = re.search(r'\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)\s+(working day|weekday)\b', temp_phrase)
            if workday_match:
                n_str = workday_match.group(1)
                is_week = "week" in temp_phrase
                is_month = month_specified or "month" in temp_phrase
            
                if is_week:
                    wd_map = {'first': 0, '1st': 0, 'second': 1, '2nd': 1, 'third': 2, '3rd': 2, 'fourth': 3, '4th': 3, 'fifth': 4, '5th': 4, 'last': 4}
                    t_wd = wd_map.get(n_str, 0)
                
                    if re.search(r'\b(next|coming)\b', temp_phrase):
                        this_monday = now_date - datetime.timedelta(days=now_date.weekday())
                        next_monday = this_monday + datetime.timedelta(days=7)
                        parsed_date = next_monday + datetime.timedelta(days=t_wd)
                    elif re.search(r'\b(last|previous)\b', temp_phrase):
                        this_monday = now_date - datetime.timedelta(days=now_date.weekday())
                        last_monday = this_monday - datetime.timedelta(days=7)
                        parsed_date = last_monday + datetime.timedelta(days=t_wd)
                    else:
                        this_monday = now_date - datetime.timedelta(days=now_date.weekday())
                        parsed_date = this_monday + datetime.timedelta(days=t_wd)
                    
                elif is_month:
                    if n_str == 'last':
                        last_d = calendar.monthrange(t_year, t_month)[1]
                        candidate = datetime.date(t_year, t_month, last_d)
                        while candidate.weekday() > 4:
                            candidate -= datetime.timedelta(days=1)
                        parsed_date = candidate
                    else:
                        n_num = int(n_str) if str(n_str).isdigit() else number_map.get(n_str, 1)
                        count = 0
                        for d in range(1, calendar.monthrange(t_year, t_month)[1] + 1):
                            candidate = datetime.date(t_year, t_month, d)
                            if candidate.weekday() <= 4:
                                count += 1
                                if count == n_num:
                                    parsed_date = candidate
                                    break

        if not parsed_date:
            if "last day" in temp_phrase and "week" not in temp_phrase and "working" not in temp_phrase:
                last_d = calendar.monthrange(t_year, t_month)[1]
                candidate = datetime.date(t_year, t_month, last_d)
                if is_datetime_past(candidate) and not month_specified:
                    t_month += 1
                    if t_month > 12:
                        t_month, t_year = 1, t_year + 1
                    last_d = calendar.monthrange(t_year, t_month)[1]
                    candidate = datetime.date(t_year, t_month, last_d)
                parsed_date = candidate

            elif 'day after tomorrow' in temp_phrase:
                parsed_date = now_date + datetime.timedelta(days=2)
            elif 'tomorrow' in temp_phrase:
                parsed_date = now_date + datetime.timedelta(days=1)
            elif 'yesterday' in temp_phrase:
                parsed_date = now_date - datetime.timedelta(days=1)
            elif 'day before yesterday' in temp_phrase:
                parsed_date = now_date - datetime.timedelta(days=2)
            elif 'today' in temp_phrase:
                parsed_date = now_date
            elif "end of the month" in temp_phrase or "end of month" in temp_phrase:
                last_d = calendar.monthrange(t_year, t_month)[1]
                candidate = datetime.date(t_year, t_month, last_d)
                if is_datetime_past(candidate) and not month_specified:
                    t_month += 1
                    if t_month > 12:
                        t_month, t_year = 1, t_year + 1
                    last_d = calendar.monthrange(t_year, t_month)[1]
                    candidate = datetime.date(t_year, t_month, last_d)
                parsed_date = candidate

        if not parsed_date:
            nth_wd_match = re.search(r'\b(\d+|first|second|third|fourth|fifth|last|final)\s+(?:week\s+)?(?:[a-z]+\s+)?(' + '|'.join(weekdays.keys()) + r')\b', temp_phrase)
            if nth_wd_match:
                n_str = nth_wd_match.group(1)
                t_wd = weekdays[nth_wd_match.group(2)]
            
                if n_str == 'last' and not month_specified:
                    pass
                else:
                    candidate = get_nth_occurrence_of_weekday(t_year, t_month, n_str, t_wd)
                    if candidate and is_datetime_past(candidate) and not month_specified:
                        temp_m = t_month + 1
                        temp_y = t_year
                        if temp_m > 12:
                            temp_m -= 12
                            temp_y += 1
                        candidate = get_nth_occurrence_of_weekday(temp_y, temp_m, n_str, t_wd)
                    parsed_date = candidate

        if not parsed_date:
            last_prev_wd = re.search(r'\b(last|previous)\s+(?:week\s+)?(' + '|'.join(weekdays.keys()) + r')\b', temp_phrase)
            if last_prev_wd and not month_specified:
                t_wd = weekdays[last_prev_wd.group(2)]
                today_wd = now_date.weekday()
            
                if "week" in last_prev_wd.group(0):
                    this_monday = now_date - datetime.timedelta(days=today_wd)
                    last_week_monday = this_monday - datetime.timedelta(days=7)
                    parsed_date = last_week_monday + datetime.timedelta(days=t_wd)
                else:
                    days_behind = (today_wd - t_wd) % 7
                    if days_behind == 0:
                        days_behind = 7
                    parsed_date = now_date - datetime.timedelta(days=days_behind)

        if not parsed_date:
            nxt_this_wd = re.search(r'\b(next|this|coming)\s+(?:week\s+)?(' + '|'.join(weekdays.keys()) + r')\b', temp_phrase)
            if nxt_this_wd:
                direction = nxt_this_wd.group(1)
                t_wd = weekdays[nxt_this_wd.group(2)]
                today_wd = now_date.weekday()
            
                if "week" in nxt_this_wd.group(0):
                    this_monday = now_date - datetime.timedelta(days=today_wd)
                    if direction == "this":
                        parsed_date = this_monday + datetime.timedelta(days=t_wd)
                    else:
                        parsed_date = this_monday + datetime.timedelta(days=7 + t_wd)
                else:
                    days_ahead = (t_wd - today_wd + 7) % 7
                    if direction == "this":
                        parsed_date = now_date + datetime.timedelta(days=days_ahead)
                    else:
                        if days_ahead == 0:
                            days_ahead = 7
                        parsed_date = now_date + datetime.timedelta(days=days_ahead)

        if not parsed_date:
            single_wd = re.search(r'\b(' + '|'.join(weekdays.keys()) + r')\b', temp_phrase)
            if single_wd and "week" not in temp_phrase:
                t_wd = weekdays[single_wd.group(1)]
                days_ahead = (t_wd - now_date.weekday() + 7) % 7
            
                parsed_date = now_date + datetime.timedelta(days=days_ahead)

        if not parsed_date:
            rel_match = re.search(r'\b(in\s+)?(\d+|' + '|'.join(number_map.keys()) + r')\s*(day|week|month)s?\s*(from now|later|ago|before)?\b', temp_phrase)
            if rel_match:
                num_str = rel_match.group(2)
                num = number_map.get(num_str, int(num_str) if num_str.isdigit() else 1)
                unit = rel_match.group(3)
                direction = rel_match.group(4) or ''
            
                is_relative_keyword = bool(rel_match.group(1) or direction)
                is_plural = temp_phrase[rel_match.end(3):rel_match.end(3)+1] == 's'
            
                if not is_relative_keyword and not is_plural and unit in ['week', 'month']:
                    pass
                else:
                    multiplier = -1 if 'ago' in direction or 'before' in direction else 1
                    if unit == 'day':
                        parsed_date = now_date + datetime.timedelta(days=multiplier * num)
                    elif unit == 'week':
                        parsed_date = now_date + datetime.timedelta(weeks=multiplier * num)
                    elif unit == 'month':
                        new_month = now_date.month + (multiplier * num)
                        new_year = target_year + (new_month - 1) // 12
                        new_month = (new_month - 1) % 12 + 1
                        last_d = calendar.monthrange(new_year, new_month)[1]
                        parsed_date = datetime.date(new_year, new_month, min(now_date.day, last_d))

        if not parsed_date:
            md_match = re.search(r'\b(' + '|'.join(month_map.keys()) + r')\s+(\d{1,2}|first|second|third|fourth|fifth|last)\b', temp_phrase)
            dm_match = re.search(r'\b(\d{1,2}|first|second|third|fourth|fifth|last)\s+(' + '|'.join(month_map.keys()) + r')\b', temp_phrase)
            if md_match or dm_match:
                if md_match:
                    m_name = md_match.group(1)
                    d_str = md_match.group(2)
                else:
                    d_str = dm_match.group(1)
                    m_name = dm_match.group(2)
            
                d_num = int(d_str) if d_str.isdigit() else number_map.get(d_str, 1)
                t_m = month_map[m_name]
                t_y = target_year
                last_d = calendar.monthrange(t_y, t_m)[1]
            
                if 1 <= d_num <= last_d:
                    candidate = datetime.date(t_y, t_m, d_num)
                
                    if not year_match:
                        try:
                            cand_next = candidate.replace(year=t_y + 1)
                        except ValueError:
                            cand_next = candidate + datetime.timedelta(days=365)
                        
                        try:
                            cand_prev = candidate.replace(year=t_y - 1)
                        except ValueError:
                            cand_prev = candidate - datetime.timedelta(days=365)
                    
                        cands = [cand_prev, candidate, cand_next]
                        candidate = min(cands, key=lambda d: abs((d - now_date).days))
                    
                    parsed_date = candidate

        if not parsed_date:
            only_day_match = re.search(r'\b(\d{1,2}|first|second|third|fourth|fifth)\b', temp_phrase)
            if only_day_match:
                d_str = only_day_match.group(1)
                d_num = int(d_str) if d_str.isdigit() else number_map.get(d_str, 1)
            
                if month_specified:
                    last_d = calendar.monthrange(t_year, t_month)[1]
                    if 1 <= d_num <= last_d:
                        parsed_date = datetime.date(t_year, t_month, d_num)
                else:
                    temp_m, temp_y = now_date.month, target_year
                
                    cands = []
                    for m_offset in [-1, 0, 1]:
                        test_m = temp_m + m_offset
                        test_y = temp_y
                        if test_m < 1:
                            test_m += 12
                            test_y -= 1
                        elif test_m > 12:
                            test_m -= 12
                            test_y += 1
                        
                        if 1 <= d_num <= calendar.monthrange(test_y, test_m)[1]:
                            cands.append(datetime.date(test_y, test_m, d_num))
                        
                    if cands:
                        if not year_match:
                            parsed_date = min(cands, key=lambda d: abs((d - now_date).days))
                        else:
                            cand_curr = [c for c in cands if c.month == temp_m and c.year == temp_y]
                            if cand_curr:
                                parsed_date = cand_curr[0]
                            else:
                                parsed_date = cands[1] if len(cands) > 1 else cands[0]

        if parsed_date:
            if "last year" in phrase_clean_for_date or "previous year" in phrase_clean_for_date:
                try:
                    parsed_date = parsed_date.replace(year=parsed_date.year - 1)
                except ValueError:
                    parsed_date = parsed_date - datetime.timedelta(days=365)
            elif "next year" in phrase_clean_for_date or "coming year" in phrase_clean_for_date:
                try:
                    parsed_date = parsed_date.replace(year=parsed_date.year + 1)
                except ValueError:
                    parsed_date = parsed_date + datetime.timedelta(days=365)

        if not parsed_date:
            if extracted_time_str:
                return {
                    "status": "failure",
                    "user_input": phrase,
                    "date": "",
                    "time": extracted_time_str,
                    "message": "user provided the time need to ask for date and validate it again"
                }
            return {
                "status": "failure",
                "user_input": phrase,
                "date": "",
                "time": "",
                "message": "Could not identify a valid date or time."
            }

        if parsed_date < now_date:
            return {
                "status": "failure",
                "user_input": phrase,
                "date": parsed_date.strftime("%d-%m-%Y %A"),
                "time": extracted_time_str,
                "message": "The mentioned date is already past."
            }

        if not extracted_time_str:
            return {
                "status": "failure",
                "user_input": phrase,
                "date": parsed_date.strftime("%d-%m-%Y %A"),
                "time": "",
                "message": "user didn't provide the time, need to ask the time and validate it again"
            }

        user_datetime = datetime.datetime.combine(parsed_date, extracted_time_obj)

        if user_datetime < now_time:
            return {
                "status": "failure",
                "user_input": phrase,
                "date": parsed_date.strftime("%d-%m-%Y %A"),
                "time": extracted_time_str,
                "message": "The mentioned time is already past."
            }
        if parsed_date.strftime("%d-%m-%Y %A").split()[-1].lower() in ["saturday","sunday"]:
            return {
            "status": "failure",
            "user_input": phrase,
            "date": parsed_date.strftime("%d-%m-%Y %A"),
            "time": extracted_time_str,
            "message": "User given date is out of business hours. Ask the user to provide a date within the business days."
        }

        return {
            "status": "success",
            "user_input": phrase,
            "date": parsed_date.strftime("%d-%m-%Y %A"),
            "time": extracted_time_str,
            "message": "date and time captured successfully"
        }
    except Exception as e:
        return {
            "status": "failure",
            "user_input": phrase,
            "date": parsed_date.strftime("%d-%m-%Y %A"),
            "time": extracted_time_str,
            "message": "we are facing some internal issue"
        }

VALIDATE_PHONE_NUMBER = {
  "type": "function",
  "function": {
    "name": "VALIDATE_PHONE_NUMBER",
    "description": "To validate global mobile numbers",
    "parameters": {
      "type": "object",
      "properties": {
        "mobile": {
          "type": "string",
          "description": "Mobile number provided by user."
        },
        "country_name": {
          "type": "string",
          "description": "full country name or country code entered by the user,abbreviation not allowed give the full country name"
        }
      },
      "required": ["mobile","country_name"]
    }
  }
}


def RESOLVE_COUNTRY_FROM_LOCATION(location_text: str):
    """
    Resolves a country/region hint from text that may be:
      - a bare calling code digit string: "91"
      - a calling code with plus: "+91"
      - a country name: "India"
      - an ISO alpha-2/alpha-3 code: "IN" / "IND"
      - free text containing a country name (via GeoText)
    """
    location_text = str(location_text).strip()
    raw = location_text
    if location_text.startswith("+"):
        location_text = location_text[1:]
 
    # 1) Bare calling code, e.g. "91" or "+91"
    if location_text.isdigit():
        for region_code, country_codes in phonenumbers.COUNTRY_CODE_TO_REGION_CODE.items():
            if int(location_text) == region_code:
                iso2 = country_codes[0]
                country = pycountry.countries.get(alpha_2=iso2)
                if country:
                    return {
                        "found": True,
                        "country_name": country.name,
                        "iso2": iso2,
                        "calling_code": f"+{region_code}"
                    }
        # Digit string didn't match any known calling code
        return {"found": False, "error": "Unrecognized calling code"}
 
    # 2) Country name / ISO alpha-2 / alpha-3
    try:
        country = pycountry.countries.lookup(location_text)
        iso2 = country.alpha_2
        calling = phonenumbers.country_code_for_region(iso2)
        return {
            "found": True,
            "country_name": country.name,
            "iso2": iso2,
            "calling_code": f"+{calling}"
        }
    except LookupError:
        pass
 
    # 3) Free text containing a country name
    places = GeoText(raw)
    if places.countries:
        country_name = list(places.countries)[0]
        try:
            country = pycountry.countries.lookup(country_name)
            iso2 = country.alpha_2
            calling = phonenumbers.country_code_for_region(iso2)
            return {
                "found": True,
                "country_name": country.name,
                "iso2": iso2,
                "calling_code": f"+{calling}"
            }
        except LookupError:
            pass
 
    return {
        "found": False,
        "error": "Location not recognized"
    }
 
 
def _try_parse(mobile: str, region: Optional[str]):
    """Returns a valid PhoneNumber object or None. Never raises."""
    try:
        number = phonenumbers.parse(mobile, region)
    except phonenumbers.NumberParseException:
        return None
    if not phonenumbers.is_valid_number(number):
        return None
    return number
 
 
def _success(number: phonenumbers.PhoneNumber,inferred: bool = False):

    result = {
        "valid": True,
        "e164": phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.E164),
        "country_code": phonenumbers.region_code_for_number(number),
    }
    if inferred:
        result["inferred_country_code"] = True

    return result
 
 
def validate_phone_number(
    mobile: str,
    country_name: Optional[str] = None,
    **kwargs
):
    try:
        mobile = str(mobile).replace(" ", "").strip()
        domain_id = kwargs.get("domainId", "")
        formatted_time = kwargs.get("formatted_time", "")
        session_id = kwargs.get("session_id")
        longterm_cache = kwargs.get("longterm_cache")
        print("longterm_cache:", longterm_cache)

        if not mobile:
            return {"valid": False, "status": "Empty number"}

        has_plus = mobile.startswith("+")

        # ── Helper: attach summary to any valid result ─────────────────────
        def _attach_summary(result: dict, national_number) -> dict:
            """Call get_conversation_summary and attach to result if not already long-term."""
            try:
                if longterm_cache and session_id:
                    is_longterm = longterm_cache.get(session_id, {}).get("islongterm", 0)
                    if not is_longterm:
                        summary = get_conversation_summary(domain_id, national_number, formatted_time)
                        result["user_detail_summary"] = summary
                        longterm_cache[session_id]["islongterm"] = 1
            except Exception as e:
                print(f"[validate_phone_number] summary fetch error: {e}")
            return result

        # ── Resolve country hint ───────────────────────────────────────────
        region_from_country = None
        if country_name:
            loc = RESOLVE_COUNTRY_FROM_LOCATION(country_name)
            print("Country resolution result:", loc)
            if not loc["found"]:
                return {"valid": False, "status": "Invalid country or country code"}
            region_from_country = loc["iso2"]

        # ── Branch 1: number already has "+" ──────────────────────────────
        if has_plus:
            number = _try_parse(mobile, None)
            if number is None:
                return {"valid": False, "status": "Invalid number format"}

            result = _success(number)

            if region_from_country and region_from_country != result["country_code"]:
                result["warning"] = (
                    f"Number's country ({result['country_code']}) does not match "
                    f"provided country hint ({region_from_country})"
                )

            return _attach_summary(result, number.national_number)  # ← summary added

        # ── Branch 2: no "+", but country hint provided ───────────────────
        if region_from_country:
            number = _try_parse(mobile, region_from_country)
            if number is None:
                return {"valid": False, "status": "Invalid mobile number"}

            result = _success(number)
            return _attach_summary(result, number.national_number)   # ← summary added

        # ── Branch 3: no "+" and no country hint — infer from digits ──────
        candidate = _try_parse("+" + mobile, None)
        if candidate is not None:
            result = _success(candidate, inferred=True)
            return _attach_summary(result, candidate.national_number) # ← summary added

        return {
            "valid": False,
            "needs_country": True,
            "status": "Please provide country code or country name"
        }

    except Exception as e:
        print("ERROR IN NUMBER VALIDATION", e)
        return {
            "status": "failure",
            "message": {"response": "Some technical Issue.", "data": {}}
        }

VALIDATE_EMAIL = {
  "type": "function",
  "function": {
    "name": "VALIDATE_EMAIL",
    "description": "Validate email format and check whether the email belongs to an existing CRM customer or prior session.",
    "parameters": {
      "type": "object",
      "properties": {
        "email_id": {
          "type": "string",
          "description": "Email address provided by the user."
        }
      },
      "required": ["email_id"]
    }
  }
}

def validate_email(email_id, **kwargs):
    try:
        email_id = (email_id or "").strip().lower()
        domain_id = kwargs.get("domainId", "")
        formatted_time = kwargs.get("formatted_time", "")
        session_id = kwargs.get("session_id")
        cookie_id = kwargs.get("cookie_id", "")
        longterm_cache = kwargs.get("longterm_cache")
        summary = ""

        pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'

        if not re.match(pattern, email_id):
            return {
                "status": "success",
                "valid": False,
                "response": "ask the user to enter the correct email id because the given is in wrong mail format",
                "message": "Invalid email format",
            }

        result = {
            "status": "success",
            "valid": True,
            "email": email_id,
            "response": "the email given by the user is a valid one",
            "message": "Valid email format",
        }

        try:
            lookup_response = lookup_webchat_tickets(email_id)
            lookup_data = lookup_response.json() if lookup_response.text else {}
            if lookup_data.get("success"):
                customer = lookup_data.get("customer") or {}
                result["customer_exists"] = True
                result["customer_name"] = customer.get("name")
                result["open_tickets"] = len(lookup_data.get("tickets") or [])
                result["response"] = (
                    f"the email is valid and linked to customer {customer.get('name', email_id)}"
                )
            elif "no customer exist" in (lookup_data.get("error") or "").lower():
                result["customer_exists"] = False
                result["response"] = (
                    "the email format is valid but no CRM customer account was found for this email"
                )
        except Exception as e:
            print(f"[validate_email] customer lookup error: {e}")

        if longterm_cache and session_id:
            is_longterm = longterm_cache.get(session_id, {}).get("islongterm", 0)
            if not is_longterm and cookie_id:
                try:
                    summary = get_conversation_summary(domain_id, cookie_id, formatted_time)
                    longterm_cache[session_id]["islongterm"] = 1
                except Exception as e:
                    print(f"[validate_email] summary fetch error: {e}")

        if summary:
            result["user_detail_summary"] = summary

        return result

    except Exception as e:
        return {
            "status": "failure",
            "valid": False,
            "message": f"we are currently unable to validate the mail id: {str(e)}"
        }

WEB_SEARCH_TOOL = {
  "type": "function",
  "function": {
    "name": "WEB_SEARCH_TOOL",
    "description": "To get external information other than worktual",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "query to fetch the external information from external source."
        }
      },
      "required": ["query"]
    }
  }
}


def websearch_tool(query,n_result = 5,**kwargs):
    try:
        print("SERPER API TOOL.............")
        url = "https://google.serper.dev/search"
        
        payload = json.dumps({
        "q": query,
        "location": "United Kingdom",
        "gl": "gb"
        })
        headers = {
        'X-API-KEY': '23b507ba6da95d200fd3fb22c320fb444fa34775',
        'Content-Type': 'application/json'
        }
        
        response = requests.request("POST", url, headers=headers, data=payload)
        # print("+++++++++++",response.text)
        data = response.json()
        # print("Serper context data",data)
        web_context = ""

        for i in data["organic"][:n_result]:
            web_context += f"Title : {i['title']}\ncontent : {i['snippet']}\nlink : {i['link']}\n\n"
        
        return {
            "status": "success",
            "result": web_context
        }       
        
    except Exception as e:
        print(f"Error: {e}")
        print("DUCK DUCK GO SEARCH........")
        results = DDGS().text(query, max_results=n_result)
        return {
                "status": "failure",
                "result": results
            }


tools_used=[
                GET_SERVICE_KNOWLEDGE,SEND_OTP,VERIFY_OTP,CREATE_TICKET,GET_TICKET_STATUS,
                BOOK_APPOINTMENT,RESCHEDULE_APPOINTMENT,CALENDAR_TOOL,GET_SALES_KNOWLEDGE,
                VALIDATE_PHONE_NUMBER,VALIDATE_EMAIL,WEB_SEARCH_TOOL,LIVE_AGENT,
        CALL_BACK,AGENT_ROUTE_TOOL
                
            ]
    

