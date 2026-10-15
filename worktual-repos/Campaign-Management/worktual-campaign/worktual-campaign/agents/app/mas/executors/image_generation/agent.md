# image_generation_executor

## role
Deprecated alias — delegates to Image domain `image_generate` executor.

## context
Use `image_generate` under the Image domain. See `executors/image_generate/agent.md`.

## skills
(deferred)

## guardrails
- Never invent CRM/campaign success.
- Enforce user_confirmed for mutating tools when required by legacy handlers.
- No cross-domain tool calls.

## input/output contract
### input
task_spec, session_id, token
### output
ok, action_status, result, message, ui_events

## allowed tools
Image-generation dependencies declared by this Executor runner.

## handoff targets
Return to parent domain only.

## memory policy
### working
action_status steps
### short-term
-
### long-term
-
### preferences
-

## approval policy
Honor user_confirmed / confirmed flags from task_spec and legacy tools.

## evaluation criteria
Grounded on tool results; correct action_status.
