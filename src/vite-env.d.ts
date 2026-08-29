/// <reference types="vite/client" />

import type { ProyaApi } from '../electron/preload';

declare global { interface Window { proya: ProyaApi; } }

export {};
