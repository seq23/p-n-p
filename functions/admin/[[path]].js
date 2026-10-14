import { handleAdmin } from '../_lib/admin.mjs';

export const onRequest = (context) => handleAdmin(context);
