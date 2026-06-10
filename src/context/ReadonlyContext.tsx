import { createContext, useContext } from 'react';

export const ReadonlyContext = createContext<boolean>(false);

/** Returns true when the app is running in read-only mode (public Cloudflare view). */
export function useReadonly(): boolean {
  return useContext(ReadonlyContext);
}
