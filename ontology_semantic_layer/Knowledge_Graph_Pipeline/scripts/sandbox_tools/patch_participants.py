with open("config/mappings/core.yaml", "r") as f:
    c = f.read()

old_rel = """  ccass.conversation_participants:
    mode: node
    label: ConversationParticipant
    key: id
    properties: [id, organization_id, conversation_id, participant_type,
                 identity_ref, joined_at, left_at]
    relationships:
      - {type: HAS_PARTICIPANT, direction: in, target_label: Conversation, target_key: id, from_column: conversation_id}"""

new_rel = """  ccass.conversation_participants:
    mode: node
    label: ConversationParticipant
    key: id
    properties: [id, organization_id, conversation_id, participant_type,
                 identity_ref, joined_at, left_at]
    relationships:
      - {type: HAS_PARTICIPANTS, direction: in, target_label: Conversation, target_key: id, from_column: conversation_id}
      - {type: HAS_PARTICIPANT, direction: out, target_label: Agent, target_key: id, from_column: identity_ref}
      - {type: HAS_PARTICIPANT, direction: out, target_label: User, target_key: id, from_column: identity_ref}
      - {type: HAS_PARTICIPANT, direction: out, target_label: Contact, target_key: cdp_id, from_column: identity_ref}"""

c = c.replace(old_rel, new_rel)

with open("config/mappings/core.yaml", "w") as f:
    f.write(c)

