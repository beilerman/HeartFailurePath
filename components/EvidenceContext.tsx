import { createContext, useContext } from 'react';

/** Lets any result card/exclusion open the Evidence tab pre-filtered to a drug or rule, without prop drilling. */
export const EvidenceContext = createContext<{ openEvidence: (query: string) => void }>({ openEvidence: () => {} });
export const useEvidenceLink = () => useContext(EvidenceContext);
