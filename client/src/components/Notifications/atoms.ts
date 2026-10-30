import { atom } from 'jotai';

/** Whether the Activity Center panel is open. Feature-owned (the bell writes and reads it). */
export const notificationsPanelOpenAtom = atom(false);
