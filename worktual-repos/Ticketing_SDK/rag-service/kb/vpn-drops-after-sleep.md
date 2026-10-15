# VPN drops after the laptop wakes

## Issue
Subject: VPN drops after the laptop wakes

Requester: Riya Shah <riya@northwind.test>

Riya's laptop loses the office VPN every time it wakes from sleep. She can reconnect once, then the client asks for credentials again.

## Reply
The VPN client is keeping a stale session after sleep. Quit the client completely, reconnect once, and confirm the version is 4.2 or newer. If it still asks for credentials, reinstall the client and send the version number.
