// The Design Library's address (owner 8 Nov 2026). Behind the admin guard (_middleware.js).
import { handleDesigns } from '../_lib/admin-library.mjs';

export const onRequest = (context) => handleDesigns(context);
