import { createContext, useContext } from "react";
import type { ConflictFile } from "@/ipc/bindings";

/**
 * Extension point for AI conflict suggestions. Returns the full proposed file content (ideally
 * without markers). The resolver shows a "Suggest resolution" button only when one is provided,
 * either through the `suggest` prop or by wrapping the app in `ConflictSuggestProvider`.
 */
export type ConflictSuggestFn = (file: ConflictFile) => Promise<string>;

const SuggestContext = createContext<ConflictSuggestFn | undefined>(undefined);

export const ConflictSuggestProvider = SuggestContext.Provider;
export const useConflictSuggest = () => useContext(SuggestContext);
