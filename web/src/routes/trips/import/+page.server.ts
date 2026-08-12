import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getAnthropicKey } from '$lib/server/import';

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!locals.user || locals.user.status !== 'approved') throw redirect(302, '/');
	// Import needs the ANTHROPIC_API_KEY secret. When it's missing the entry
	// points are already hidden (see +layout.server.ts), but the route stays
	// reachable by bookmark and from the /guide entry — so say so up front
	// instead of letting someone paste an itinerary and hit a 501 afterwards.
	return { enabled: !!getAnthropicKey(platform) };
};
