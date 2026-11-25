/** R12 D5(a): the words a screen shows for a drug class. The internal class key `nsMRA` is never shown; filters and rows keep matching on the key. */
export const drugClassLabel = (drugClass: string): string => (drugClass === 'nsMRA' ? 'nonsteroidal MRA' : drugClass);
