# Checkout fails when the card ends in 4242

## Issue
Subject: Checkout fails when the card ends in 4242

Requester: Amira Hassan <amira@harborco.test>

Customers whose cards end in 4242 get “Payment could not be completed” on the last step. Other cards go through. Amira saw it twice in the last hour, and the orders do not appear in the sales list.

## Reply
The payment gateway is rejecting cards that end in 4242. Ask the customer to use a different card. Those attempts do not create an order, so they will not show in the sales list. Send finance the time of the attempt and the last four digits so they can clear the rule.
