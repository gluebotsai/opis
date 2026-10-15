import { createContext, useContext, useMemo, useState } from "react";

import {
  INITIAL_CUSTOMER_CONTACTS,
  INITIAL_INTEGRATIONS,
  INITIAL_KNOWLEDGE,
} from "./setupMockData.js";

const SetupWorkspaceContext = createContext(null);

export function SetupWorkspaceProvider({ children }) {
  const [knowledgeDocs, setKnowledgeDocs] = useState(INITIAL_KNOWLEDGE);
  const [integrations, setIntegrations] = useState(INITIAL_INTEGRATIONS);
  const [customerContacts, setCustomerContacts] = useState(INITIAL_CUSTOMER_CONTACTS);

  const value = useMemo(
    () => ({
      knowledgeDocs,
      integrations,
      customerContacts,
      addKnowledgeDoc(doc) {
        setKnowledgeDocs((current) => [...current, doc]);
      },
      removeKnowledgeDoc(id) {
        setKnowledgeDocs((current) => current.filter((doc) => doc.id !== id));
      },
      toggleIntegration(id) {
        setIntegrations((current) =>
          current.map((item) =>
            item.id === id ? { ...item, connected: !item.connected } : item,
          ),
        );
      },
      addCustomerContacts(contacts) {
        setCustomerContacts((current) => [...current, ...contacts]);
      },
    }),
    [knowledgeDocs, integrations, customerContacts],
  );

  return (
    <SetupWorkspaceContext.Provider value={value}>{children}</SetupWorkspaceContext.Provider>
  );
}

export function useSetupWorkspace() {
  const context = useContext(SetupWorkspaceContext);
  if (!context) {
    throw new Error("useSetupWorkspace must be used within SetupWorkspaceProvider");
  }
  return context;
}
