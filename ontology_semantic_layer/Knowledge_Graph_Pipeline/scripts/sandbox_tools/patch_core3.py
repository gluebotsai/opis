with open("config/mappings/core.yaml", "r") as f:
    c = f.read()

# Uncomment Contact to Conversation
c = c.replace(
    "# - {type: PARTICIPATED_IN, direction: in, target_label: Contact, target_key: cdp_id, from_column: contact_id}",
    "- {type: PARTICIPATED_IN, direction: in, target_label: Contact, target_key: cdp_id, from_column: contact_id}"
)

# Remove User relationship from ConversationParticipant
c = c.replace(
    "      - {type: HAS_PARTICIPANT, direction: out, target_label: User, target_key: id, from_column: identity_ref}\n",
    ""
)

with open("config/mappings/core.yaml", "w") as f:
    f.write(c)
