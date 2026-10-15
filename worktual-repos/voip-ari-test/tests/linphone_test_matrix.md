# Linphone Softphone Validation Matrix

| Test ID | Test Description | Expected Result | Result |
| --- | --- | --- | --- |
| **TC-01** | Linphone Extension 1001 SIP Registration | Green "Connected" indicator in Linphone | PASSED |
| **TC-02** | Linphone Extension 1002 SIP Registration | Green "Connected" indicator in Linphone | PASSED |
| **TC-03** | Dial Audio Echo Test `600` from 1001 | Microphone audio echoed back clearly | PASSED |
| **TC-04** | Call Origination 1001 ➔ 1002 | Extension 1002 softphone rings | PASSED |
| **TC-05** | Call Answer 1002 | Call state updates to `ANSWERED` & audio connects | PASSED |
| **TC-06** | Call Hold from API Gateway | Linphone hears Music On Hold (MOH) | PASSED |
| **TC-07** | Call Resume from API Gateway | MOH stops & bidirectional audio resumes | PASSED |
| **TC-08** | Call Mute / Unmute | Microphone stream silenced and resumed | PASSED |
| **TC-09** | Call Hangup from 1001 or API | Call disconnects & Stasis ARI releases channel | PASSED |
| **TC-10** | Real-Time WebSocket Broadcast | Admin UI updates live without page reload | PASSED |
