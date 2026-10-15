# approved_launch

## purpose
Send or schedule the approved template after audience + explicit confirmation.

## when
Audience is ready; user confirms timing (now or scheduled).

## actions
- Summarize template + audience + timing; ask explicit yes.
- Quick immediate send (esp. single test number) → **SEND_APPROVED_TEMPLATE** with user_confirmed=true.
- Monitoring campaign (schedule / launch / batches) → **LAUNCH_APPROVED_CAMPAIGN** with user_confirmed=true, schedule_mode, optional date/time/timezone.
- Pass **body_params** when template uses {{1}}, {{2}}, …

## tools
SEND_APPROVED_TEMPLATE, LAUNCH_APPROVED_CAMPAIGN

## completion
Tool returned ok=true; never claim success without tool result.
