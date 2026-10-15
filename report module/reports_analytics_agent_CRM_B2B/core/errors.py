# origin: ticketing_v2/core/errors.py
from typing import Optional, Dict, Any

class ReportingError(Exception):
    """Base exception for CRM analytics errors."""
    def __init__(self, message: str, code: str = "INTERNAL_ERROR", details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.details = details or {}

class GuardRejectionError(ReportingError):
    """Raised when SQL or Cypher fails AST security inspection."""
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, code="GUARD_REJECTION", details=details)

class AccessDeniedError(ReportingError):
    """Raised when a user attempts to access out-of-role data or unauthorized views."""
    def __init__(self, message: str = "This metric or view is not available for your role.", details: Optional[Dict[str, Any]] = None):
        super().__init__(message, code="ACCESS_DENIED", details=details)

class UnavailableKPIError(ReportingError):
    """Raised when a requested KPI cannot be calculated due to missing schema inputs."""
    def __init__(self, message: str, kpi_id: str, missing_input: str):
        super().__init__(message, code="KPI_UNAVAILABLE", details={"kpi_id": kpi_id, "missing_input": missing_input})

class GroundingFailureError(ReportingError):
    """Raised when an answer contains numbers not grounded in the SQL fact sheet."""
    def __init__(self, message: str, ungrounded_numbers: list):
        super().__init__(message, code="GROUNDING_FAILURE", details={"ungrounded": ungrounded_numbers})
