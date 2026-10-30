import { handleOutreach } from '../../_lib/outreach.mjs';
export const onRequest = (context) => handleOutreach(context, 'send');
