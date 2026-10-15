"""Shared error types.

Every failure in this pipeline is one of three kinds:

  ConfigError    -- static, detected at startup, aborts the process (exit 1).
  MappingError   -- a mapping cannot express this row; startup or write time.
  CoercionError  -- one event's value cannot be represented safely.
                    NEVER fatal to the process; the event is quarantined.

The distinction matters: a CoercionError must not take down the consumer,
because one bad row in one tenant would stop every other tenant's stream.
"""


class ConfigError(Exception):
    """Static configuration is invalid. Fail loudly at startup, never continue."""


class MappingError(ConfigError):
    """A mapping entry is structurally unusable."""


class CoercionError(Exception):
    """A single value could not be safely converted. Quarantine the event."""


class ProvisioningError(Exception):
    """Database or constraint provisioning failed."""


class PreflightError(Exception):
    """A source-system prerequisite is not met."""
